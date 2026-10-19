//! The Studio: ArtCraft (local image, video and 3D tools) built into the app,
//! and installed on demand.
//!
//! ArtCraft's Rust side is compiled into this process (`artcraft_app_lib`,
//! from `studio/`): its plugins and state are added to the app's builder and
//! its commands are routed by name. Its background services only start once
//! the Studio is installed. Its UI is not shipped in the installer: Settings
//! (or the Studio page) downloads it from this version's GitHub release into
//! `<app data>/studio/app`, with the tools the owner picked, and it is served
//! to the Studio view through the `studio://` protocol. The view is a child
//! webview of the main window, laid over the Studio page by `studio_place`.
//!
//! Development: `BUZZ_STUDIO_DIR` points at a local build (the folder holding
//! `studio-app/`) and counts as installed.

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use artcraft_app_lib::core::embedding::{embedded_webview_builder, EMBEDDED_WEBVIEW_LABEL};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::http::{Request, Response, StatusCode};
use tauri::ipc::Invoke;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Wry};

pub use artcraft_app_lib::Startup;

/// The local tools the Studio offers (ArtCraft's tab ids).
pub const TOOLS: &[&str] = &[
    "2D",
    "3D",
    "VIDEO_EDITOR",
    "VIDEO_FRAME_EXTRACTOR",
    "STORYBOARD",
    "MOODBOARD",
];

const PROTOCOL: &str = "studio";
const RELEASES_URL: &str = "https://github.com/KenFromBarbie/Kenns-Harness/releases/download";
const MAX_DOWNLOAD_BYTES: u64 = 250 * 1024 * 1024;
const PROGRESS_EVENT: &str = "studio-install-progress";

/// ArtCraft's background startup, held until the Studio is installed.
#[derive(Default)]
pub struct StudioRuntime {
    startup: Mutex<Option<Startup>>,
    /// The app's current look (JSON from `studio_theme`), for the Studio view.
    theme: Mutex<Option<String>>,
}

/// Runs first in the Studio view: lays the app's colours and font over
/// ArtCraft's own (its shadcn and `--st-*` variables), now and whenever the
/// app's theme changes (`studio_theme`).
const THEME_SCRIPT: &str = r#"(function () {
  function apply(theme) {
    if (!theme || !theme.vars) return;
    window.__HARNESS_THEME__ = theme;
    var css = ":root, :root.theme-light, .theme-light, .theme-dark {";
    for (var name in theme.vars) {
      if (/^--[a-z0-9-]+$/.test(name)) css += name + ": " + String(theme.vars[name]).replace(/[;{}<]/g, "") + " !important;";
    }
    css += "} html, body { color-scheme: " + (theme.dark ? "dark" : "light") + "; }";
    if (theme.font) css += " body { font-family: " + String(theme.font).replace(/[;{}<]/g, "") + "; }";
    var el = document.getElementById("harness-theme") || document.createElement("style");
    el.id = "harness-theme";
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }
  window.__applyHarnessTheme = apply;
  var boot = function () { apply(window.__HARNESS_THEME__); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();"#;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StudioSettings {
    /// The app version whose Studio files are installed.
    #[serde(default)]
    version: Option<String>,
    /// The tools shown in the Studio.
    #[serde(default)]
    tools: Vec<String>,
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

/// ArtCraft's plugins and state, and the `studio://` protocol serving its UI.
pub fn install(builder: tauri::Builder<Wry>) -> (tauri::Builder<Wry>, Startup) {
    let (builder, startup) = artcraft_app_lib::install(builder);
    let builder = builder
        .manage(StudioRuntime::default())
        .register_uri_scheme_protocol(PROTOCOL, |ctx, request| {
            serve(ctx.app_handle(), &request)
        });
    (builder, startup)
}

/// Start ArtCraft's background work now if the Studio is installed, or keep
/// it for when it is.
pub fn start_if_installed(app: &AppHandle, startup: Startup) {
    if files_dir(app).is_some() {
        startup.start_embedded(app);
    } else if let Ok(mut held) = app.state::<StudioRuntime>().startup.lock() {
        *held = Some(startup);
    }
}

fn start_held(app: &AppHandle) {
    let startup = app
        .state::<StudioRuntime>()
        .startup
        .lock()
        .ok()
        .and_then(|mut held| held.take());
    if let Some(startup) = startup {
        startup.start_embedded(app);
    }
}

/// The app's command handler with ArtCraft's commands routed to ArtCraft's.
/// The two sets of names don't overlap.
pub fn with_artcraft_commands(
    buzz: impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    let artcraft = artcraft_app_lib::invoke_handler();
    move |invoke| {
        if artcraft_app_lib::COMMANDS.contains(&invoke.message.command()) {
            artcraft(invoke)
        } else {
            buzz(invoke)
        }
    }
}

// ─── Where the files are ─────────────────────────────────────────────────────

fn studio_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("studio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Where releases are downloaded from. Development builds can point it at a
/// local copy (`BUZZ_STUDIO_RELEASES_URL`, the part before `/v<version>`) to
/// test installing without publishing a release.
fn releases_url() -> String {
    if cfg!(debug_assertions) {
        if let Ok(url) = std::env::var("BUZZ_STUDIO_RELEASES_URL") {
            return url.trim_end_matches('/').to_string();
        }
    }
    RELEASES_URL.to_string()
}

fn dev_dir() -> Option<PathBuf> {
    std::env::var_os("BUZZ_STUDIO_DIR").map(PathBuf::from)
}

/// The folder holding `studio-app/`, when the Studio is installed.
fn files_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = dev_dir().or_else(|| studio_root(app).ok().map(|root| root.join("app")))?;
    dir.join("studio-app")
        .join("index.html")
        .is_file()
        .then_some(dir)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(studio_root(app)?.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> StudioSettings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &StudioSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))
}

fn clean_tools(tools: Vec<String>) -> Result<Vec<String>, String> {
    let picked: Vec<String> = TOOLS
        .iter()
        .filter(|t| tools.iter().any(|p| p == *t))
        .map(|t| t.to_string())
        .collect();
    if picked.is_empty() {
        return Err("Pick at least one tool.".into());
    }
    Ok(picked)
}

// ─── Serving the UI ──────────────────────────────────────────────────────────

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("glb") => "model/gltf-binary",
        Some("gltf") => "model/gltf+json",
        _ => "application/octet-stream",
    }
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Cache-Control", "no-cache")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// A file from the installed Studio; unknown app routes get its index page.
fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(root) = files_dir(app) else {
        return respond(
            StatusCode::NOT_FOUND,
            "text/plain",
            b"The Studio isn't installed.".to_vec(),
        );
    };
    let raw = request.uri().path();
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map(|p| p.into_owned())
        .unwrap_or_else(|_| raw.to_string());
    let relative = Path::new(decoded.trim_start_matches('/'));
    // Only plain names below the root: no "..", no drive or root prefixes.
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return respond(StatusCode::FORBIDDEN, "text/plain", Vec::new());
    }
    let mut path = root.join(relative);
    if path.is_dir() {
        path = path.join("index.html");
    }
    if !path.is_file() && relative.extension().is_none() {
        path = root.join("studio-app").join("index.html");
    }
    match std::fs::read(&path) {
        Ok(bytes) => respond(StatusCode::OK, content_type(&path), bytes),
        Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

fn studio_url() -> Result<url::Url, String> {
    let url = if cfg!(any(windows, target_os = "android")) {
        format!("http://{PROTOCOL}.localhost/studio-app/index.html")
    } else {
        format!("{PROTOCOL}://localhost/studio-app/index.html")
    };
    url::Url::parse(&url).map_err(|e| e.to_string())
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioStatus {
    installed: bool,
    /// A local development build (BUZZ_STUDIO_DIR) is in use.
    dev_build: bool,
    /// The app version whose Studio files are installed.
    version: Option<String>,
    app_version: String,
    tools: Vec<String>,
    all_tools: Vec<&'static str>,
}

#[tauri::command]
pub fn studio_status(app: AppHandle) -> StudioStatus {
    let settings = load_settings(&app);
    StudioStatus {
        installed: files_dir(&app).is_some(),
        dev_build: dev_dir().is_some(),
        version: settings.version.clone(),
        app_version: app.package_info().version.to_string(),
        tools: if settings.tools.is_empty() {
            TOOLS.iter().map(|t| t.to_string()).collect()
        } else {
            settings.tools
        },
        all_tools: TOOLS.to_vec(),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

async fn download(app: &AppHandle, url: &str, progress: bool) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(
            "This version's Studio download isn't on GitHub (it comes with release builds)."
                .into(),
        );
    }
    if !response.status().is_success() {
        return Err(format!("GitHub answered {}", response.status()));
    }
    let total = response.content_length();
    if total.is_some_and(|t| t > MAX_DOWNLOAD_BYTES) {
        return Err("The Studio download is unexpectedly large.".into());
    }
    let mut bytes = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut stream = response.bytes_stream();
    let mut last = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
            return Err("The Studio download is unexpectedly large.".into());
        }
        let received = bytes.len() as u64;
        if progress && received - last > 512 * 1024 {
            last = received;
            let _ = app.emit(
                PROGRESS_EVENT,
                Progress {
                    phase: "downloading",
                    received,
                    total,
                },
            );
        }
    }
    Ok(bytes)
}

fn unpack(zip_bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| format!("The download isn't a valid archive: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name refuses "..", absolute and drive paths.
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let out = dest.join(name);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        std::fs::write(&out, data).map_err(|e| format!("write {}: {e}", out.display()))?;
    }
    Ok(())
}

/// Reload an open Studio view with new files or tools. (Closing it to open a
/// new one leaves its label taken for seconds, so the page couldn't reopen it.)
/// The tools go through the view's session storage, which its startup script
/// reads before the ones it was opened with.
fn reload_view(app: &AppHandle, tools: &[String]) {
    if let Some(webview) = app.get_webview(EMBEDDED_WEBVIEW_LABEL) {
        let json = serde_json::to_string(tools).unwrap_or_else(|_| "null".into());
        let _ = webview.eval(format!(
            "try {{ sessionStorage.setItem('harness-tools', JSON.stringify({json})); }} catch (e) {{}} location.reload();"
        ));
    }
}

/// Close the Studio view (when its files are removed).
fn close_view(app: &AppHandle) {
    if let Some(webview) = app.get_webview(EMBEDDED_WEBVIEW_LABEL) {
        let _ = webview.close();
    }
}

/// Download this version's Studio from GitHub, check it, and install it with
/// the picked tools.
#[tauri::command]
pub async fn studio_install(app: AppHandle, tools: Vec<String>) -> Result<StudioStatus, String> {
    let tools = clean_tools(tools)?;
    let version = app.package_info().version.to_string();
    let name = format!("studio-app-{version}.zip");
    let base = format!("{}/v{version}", releases_url());

    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            phase: "downloading",
            received: 0,
            total: None,
        },
    );
    let checksum = download(&app, &format!("{base}/{name}.sha256"), false).await?;
    let expected = String::from_utf8_lossy(&checksum)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let archive = download(&app, &format!("{base}/{name}"), true).await?;
    let actual = hex::encode(Sha256::digest(&archive));
    if expected.len() != 64 || actual != expected {
        return Err("The Studio download didn't match its checksum, so it wasn't installed.".into());
    }

    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            phase: "installing",
            received: archive.len() as u64,
            total: Some(archive.len() as u64),
        },
    );
    let root = studio_root(&app)?;
    let staging = root.join("app.new");
    if staging.exists() {
        crate::ai_accounts::move_to_trash(&staging)?;
    }
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let unpack_root = staging.clone();
    tokio::task::spawn_blocking(move || unpack(&archive, &unpack_root))
        .await
        .map_err(|e| e.to_string())??;
    if !staging.join("studio-app").join("index.html").is_file() {
        return Err("The download doesn't contain the Studio.".into());
    }
    let current = root.join("app");
    if current.exists() {
        crate::ai_accounts::move_to_trash(&current)?;
    }
    std::fs::rename(&staging, &current).map_err(|e| format!("install: {e}"))?;
    reload_view(&app, &tools);
    save_settings(
        &app,
        &StudioSettings {
            version: Some(version),
            tools,
        },
    )?;
    start_held(&app);
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            phase: "done",
            received: 0,
            total: None,
        },
    );
    Ok(studio_status(app))
}

/// Change which tools the Studio shows.
#[tauri::command]
pub fn studio_set_tools(app: AppHandle, tools: Vec<String>) -> Result<StudioStatus, String> {
    let tools = clean_tools(tools)?;
    let mut settings = load_settings(&app);
    settings.tools = tools;
    save_settings(&app, &settings)?;
    reload_view(&app, &settings.tools);
    Ok(studio_status(app))
}

/// Remove the Studio's files (to the Recycle Bin / Trash). Its background
/// services stop when the app restarts.
#[tauri::command]
pub fn studio_uninstall(app: AppHandle) -> Result<StudioStatus, String> {
    if dev_dir().is_some() {
        return Err("A development build of the Studio is in use (BUZZ_STUDIO_DIR).".into());
    }
    close_view(&app);
    let current = studio_root(&app)?.join("app");
    if current.exists() {
        crate::ai_accounts::move_to_trash(&current)?;
    }
    let mut settings = load_settings(&app);
    settings.version = None;
    save_settings(&app, &settings)?;
    Ok(studio_status(app))
}

/// The app's look for the Studio view (colours as CSS variables, the font,
/// light or dark); applied now if it's open, and when it next opens.
#[tauri::command]
pub fn studio_theme(app: AppHandle, theme: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string(&theme).map_err(|e| e.to_string())?;
    if let Ok(mut held) = app.state::<StudioRuntime>().theme.lock() {
        *held = Some(json.clone());
    }
    if let Some(webview) = app.get_webview(EMBEDDED_WEBVIEW_LABEL) {
        let _ = webview.eval(format!(
            "window.__applyHarnessTheme && window.__applyHarnessTheme({json});"
        ));
    }
    Ok(())
}

/// Show ArtCraft's view over the Studio page's content area (logical pixels,
/// relative to the main window), or hide it when the page isn't showing.
#[tauri::command]
pub async fn studio_place(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width.max(1.0), height.max(1.0));
    let webview = match app.get_webview(EMBEDDED_WEBVIEW_LABEL) {
        Some(webview) => webview,
        None if !visible => return Ok(()),
        None => {
            if files_dir(&app).is_none() {
                return Err("The Studio isn't installed.".into());
            }
            let tools = studio_status(app.clone()).tools;
            let theme = app
                .state::<StudioRuntime>()
                .theme
                .lock()
                .ok()
                .and_then(|t| t.clone())
                .unwrap_or_else(|| "null".into());
            let script = format!(
                "window.__ARTCRAFT_TOOLS__ = (function () {{ try {{ var t = JSON.parse(sessionStorage.getItem('harness-tools') || 'null'); if (Array.isArray(t)) return t; }} catch (e) {{}} return {}; }})();
window.__HARNESS_THEME__ = {theme};
{THEME_SCRIPT}",
                serde_json::to_string(&tools).map_err(|e| e.to_string())?
            );
            let window = app.get_window("main").ok_or("main window not found")?;
            // Two placements at once (the page asks on open and on its first
            // resize) both find no view; the second then waits for the
            // first's view to register and moves that one. A view closed a
            // moment ago can also still hold the label briefly.
            let mut attempt = 0;
            let webview = loop {
                let builder = embedded_webview_builder(WebviewUrl::CustomProtocol(studio_url()?))
                    .initialization_script(&script);
                match window.add_child(builder, position, size) {
                    Ok(_) => return Ok(()),
                    Err(e) if attempt < 30 && e.to_string().contains("already exists") => {
                        attempt += 1;
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        if let Some(webview) = app.get_webview(EMBEDDED_WEBVIEW_LABEL) {
                            break webview;
                        }
                    }
                    Err(e) => return Err(format!("could not open the Studio: {e}")),
                }
            };
            webview
        }
    };
    if visible {
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
    } else {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_are_filtered_to_known_ones_in_order() {
        let picked = clean_tools(vec!["MOODBOARD".into(), "IMAGE".into(), "2D".into()]).unwrap();
        assert_eq!(picked, vec!["2D".to_string(), "MOODBOARD".to_string()]);
        assert!(clean_tools(vec!["IMAGE".into()]).is_err());
    }

    #[test]
    fn unpack_keeps_files_inside_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out");
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::SimpleFileOptions = Default::default();
            zip.start_file("studio-app/index.html", opts).unwrap();
            std::io::Write::write_all(&mut zip, b"<html></html>").unwrap();
            zip.start_file("../escape.txt", opts).unwrap();
            std::io::Write::write_all(&mut zip, b"nope").unwrap();
            zip.finish().unwrap();
        }
        unpack(&buf, &dest).unwrap();
        assert!(dest.join("studio-app/index.html").is_file());
        assert!(!dir.path().join("escape.txt").exists());
    }

    #[test]
    fn content_types_cover_the_studio_bundle() {
        assert!(content_type(Path::new("a/index.html")).starts_with("text/html"));
        assert!(content_type(Path::new("x.JS")).starts_with("text/javascript"));
        assert_eq!(content_type(Path::new("m.wasm")), "application/wasm");
    }
}
