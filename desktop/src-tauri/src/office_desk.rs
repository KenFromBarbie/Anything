//! What the Office's agents show the owner: the things they made (the
//! Artifacts page) and pages they open in the app's Browser.
//!
//! Agents ask through the bridge (`buzz-show`, `buzz-browse`), which writes an
//! `MD_OFFICE_ACTION` JSON line on the sidecar's stdout. Artifacts are already
//! saved in the hive by then (`shared/artifacts`), so the app only tells the
//! page. Browser requests are carried out here, in a child webview of the main
//! window, and answered on the sidecar's stdin (`browse-result`).
//!
//! The Browser shows arbitrary sites, so it is a plain webview: no capability
//! names it and remote origins get no IPC, so pages can't reach the app.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

use crate::office::OfficeScope;

pub(crate) const ACTION_PREFIX: &str = "MD_OFFICE_ACTION ";
const BROWSER_LABEL: &str = "agent-browser";
/// The Browser page and agents' pages share this event: a page loaded, or an
/// agent opened one.
const BROWSER_EVENT: &str = "agent-browser";
const ARTIFACT_EVENT: &str = "office-artifact";
const PAGE_TEXT_CHARS: usize = 20_000;

/// An `MD_OFFICE_ACTION` line from a running Office.
pub(crate) fn handle_action(app: &AppHandle, scope: &OfficeScope, line: &str) {
    let Ok(msg) = serde_json::from_str::<Value>(line) else {
        eprintln!("buzz-office: unreadable action");
        return;
    };
    match msg["type"].as_str() {
        Some("artifact") => {
            allow_artifacts(app);
            let _ = app.emit(ARTIFACT_EVENT, &msg["artifact"]);
        }
        Some("browse") => {
            let app = app.clone();
            let scope = scope.clone();
            tauri::async_runtime::spawn(async move {
                let id = msg["id"].as_str().unwrap_or_default().to_string();
                let reply = match agent_browse(&app, &msg).await {
                    Ok(result) => json!({ "type": "browse-result", "id": id, "result": result }),
                    Err(error) => json!({ "type": "browse-result", "id": id, "error": error }),
                };
                crate::office::send_to_sidecar(&app, &scope, &format!("{reply}\n"));
            });
        }
        _ => {}
    }
}

/// An http(s) address, or why not (the Browser never opens files or app pages).
fn web_url(url: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url.trim().parse().map_err(|_| format!("not an address: {url}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("the Browser only opens http(s) pages, not {other}:")),
    }
}

/// The Browser's webview, made (hidden, until the page places it) if needed.
async fn browser(app: &AppHandle, first: Option<tauri::Url>) -> Result<Webview, String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        if let Some(url) = first {
            webview.navigate(url).map_err(|e| e.to_string())?;
        }
        return Ok(webview);
    }
    let window = app.get_window("main").ok_or("main window not found")?;
    let url = first.unwrap_or_else(|| "about:blank".parse().expect("valid url"));
    let events = app.clone();
    let builder = WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(url)).on_page_load(
        move |_webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = events.emit(
                    BROWSER_EVENT,
                    json!({ "op": "loaded", "url": payload.url().as_str() }),
                );
            }
        },
    );
    let webview = window
        .add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1280.0, 800.0))
        .map_err(|e| format!("could not open the Browser: {e}"))?;
    webview.hide().map_err(|e| e.to_string())?;
    Ok(webview)
}

/// Run `js` in the page and return its JSON result. The script returns a
/// JSON string (exceptions are swallowed on Windows, so it catches its own).
async fn eval_json(webview: &Webview, js: &str) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Mutex::new(Some(tx));
    webview
        .eval_with_callback(js, move |out| {
            if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(out);
            }
        })
        .map_err(|e| e.to_string())?;
    // Generous: right after the app starts, its UI thread can be busy for a
    // while before the page's answer comes back.
    let out = tokio::time::timeout(Duration::from_secs(20), rx)
        .await
        .map_err(|_| "the page did not answer")?
        .map_err(|_| "the page did not answer")?;
    match serde_json::from_str::<Value>(&out).map_err(|e| e.to_string())? {
        Value::String(inner) => serde_json::from_str(&inner).map_err(|e| e.to_string()),
        other => Ok(other),
    }
}

const READ_SCRIPT: &str = r#"(function () {
  try {
    var links = Array.prototype.slice.call(document.links, 0, 80).map(function (a) {
      return { text: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 100), href: a.href };
    });
    return JSON.stringify({
      url: location.href,
      title: document.title,
      ready: document.readyState,
      text: ((document.body && document.body.innerText) || '').slice(0, __LIMIT__),
      links: links
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()"#;

async fn read_page(webview: &Webview) -> Result<Value, String> {
    let page = eval_json(webview, &READ_SCRIPT.replace("__LIMIT__", &PAGE_TEXT_CHARS.to_string())).await?;
    match page.get("error").and_then(Value::as_str) {
        Some(error) => Err(error.to_string()),
        None => Ok(page),
    }
}

/// Wait (up to `secs`) for the page to finish loading, then read it.
async fn settle_and_read(webview: &Webview, secs: u64) -> Result<Value, String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(secs);
    tokio::time::sleep(Duration::from_millis(400)).await;
    loop {
        let page = read_page(webview).await;
        let done = matches!(&page, Ok(p) if p["ready"] == "complete");
        if done || std::time::Instant::now() >= deadline {
            return page;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

async fn agent_browse(app: &AppHandle, msg: &Value) -> Result<Value, String> {
    let agent = msg["agent"].as_str().unwrap_or("An agent");
    match msg["op"].as_str().unwrap_or("open") {
        "open" => {
            let url = web_url(msg["url"].as_str().unwrap_or_default())?;
            let webview = browser(app, Some(url.clone())).await?;
            let _ = app.emit(BROWSER_EVENT, json!({ "op": "open", "url": url.as_str(), "agent": agent }));
            // The page is open even if reading it back is slow: say so with
            // its address rather than failing the open.
            match settle_and_read(&webview, 20).await {
                Ok(page) => {
                    Ok(json!({ "url": page["url"], "title": page["title"], "opened": true }))
                }
                Err(error) => Ok(json!({
                    "url": webview.url().map(|u| u.to_string()).unwrap_or_else(|_| url.to_string()),
                    "opened": true,
                    "note": format!("opened, but couldn't read the page yet ({error}); try --read in a moment"),
                })),
            }
        }
        "read" => {
            let webview = app
                .get_webview(BROWSER_LABEL)
                .ok_or("the Browser has no page open: use --open <url> first")?;
            settle_and_read(&webview, 10).await
        }
        "back" => {
            let webview = app.get_webview(BROWSER_LABEL).ok_or("the Browser has no page open")?;
            webview.eval("history.back()").map_err(|e| e.to_string())?;
            let page = settle_and_read(&webview, 15).await?;
            Ok(json!({ "url": page["url"], "title": page["title"] }))
        }
        "reload" => {
            let webview = app.get_webview(BROWSER_LABEL).ok_or("the Browser has no page open")?;
            webview.reload().map_err(|e| e.to_string())?;
            let page = settle_and_read(&webview, 20).await?;
            Ok(json!({ "url": page["url"], "title": page["title"] }))
        }
        other => Err(format!("unknown Browser action: {other}")),
    }
}

// ─── The Browser page ───────────────────────────────────────────────────────

/// Show the Browser over the Browser page's content area (logical pixels,
/// relative to the main window), or hide it when the page isn't showing.
#[tauri::command]
pub async fn browser_place(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let webview = match app.get_webview(BROWSER_LABEL) {
        Some(webview) => webview,
        None if !visible => return Ok(()),
        None => browser(&app, None).await?,
    };
    if visible {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
    } else {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Go to an address typed in the Browser page (a bare host gets https://).
#[tauri::command]
pub async fn browser_navigate(app: AppHandle, url: String) -> Result<String, String> {
    let url = url.trim();
    let full = if url.contains("://") {
        url.to_string()
    } else if url.starts_with("localhost") || url.starts_with("127.0.0.1") {
        format!("http://{url}")
    } else {
        format!("https://{url}")
    };
    let parsed = web_url(&full)?;
    browser(&app, Some(parsed.clone())).await?;
    Ok(parsed.to_string())
}

/// Back, forward or reload, from the Browser page's toolbar.
#[tauri::command]
pub async fn browser_go(app: AppHandle, action: String) -> Result<(), String> {
    let Some(webview) = app.get_webview(BROWSER_LABEL) else {
        return Ok(());
    };
    match action.as_str() {
        "back" => webview.eval("history.back()"),
        "forward" => webview.eval("history.forward()"),
        "reload" => webview.reload(),
        _ => return Err(format!("unknown action: {action}")),
    }
    .map_err(|e| e.to_string())
}

/// The Browser's current address and title (empty before anything opened).
#[tauri::command]
pub async fn browser_state(app: AppHandle) -> Result<Value, String> {
    let Some(webview) = app.get_webview(BROWSER_LABEL) else {
        return Ok(json!({ "url": "", "title": "" }));
    };
    let url = webview.url().map(|u| u.to_string()).unwrap_or_default();
    let title = eval_json(&webview, "JSON.stringify(document.title)")
        .await
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    Ok(json!({ "url": if url == "about:blank" { String::new() } else { url }, "title": title }))
}

// ─── The Artifacts page ─────────────────────────────────────────────────────

/// The active Office's artifacts folder (`<hive>/shared/artifacts`).
fn artifacts_dir(app: &AppHandle) -> Option<PathBuf> {
    let user_data = crate::office::active_office_dir(app)?;
    let config: Value =
        serde_json::from_slice(&std::fs::read(user_data.join("config.json")).ok()?).ok()?;
    let home = config["harnessHome"].as_str()?;
    Some(PathBuf::from(home).join("hive").join("shared").join("artifacts"))
}

/// Let the page load the artifacts' files (the asset protocol), and nothing else.
fn allow_artifacts(app: &AppHandle) {
    if let Some(dir) = artifacts_dir(app) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    }
}

/// A stored relative path (`<id>/<name>`) inside the artifacts folder, or None.
fn inside(dir: &std::path::Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
        return None;
    }
    let path = dir.join(rel);
    path.starts_with(dir).then_some(path)
}

fn artifact_list(dir: &std::path::Path) -> Vec<Value> {
    let Ok(bytes) = std::fs::read(dir.join("index.json")) else {
        return Vec::new();
    };
    let Ok(Value::Array(mut items)) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    for item in items.iter_mut() {
        for (key, abs) in [("file", "path"), ("preview", "previewPath")] {
            let full = item[key].as_str().and_then(|rel| inside(dir, rel));
            if let Some(full) = full {
                item[abs] = Value::String(full.to_string_lossy().into_owned());
            }
        }
    }
    items.reverse(); // newest first
    items
}

/// Everything the active Office's agents have shown the owner, newest first.
#[tauri::command]
pub async fn office_artifacts(app: AppHandle) -> Result<Vec<Value>, String> {
    let Some(dir) = artifacts_dir(&app) else {
        return Ok(Vec::new());
    };
    allow_artifacts(&app);
    Ok(artifact_list(&dir))
}

/// The Studio's quick edits (crop, rotate, draw, text) on an image artifact:
/// the result is a new artifact next to it, "(edited)", by you.
#[tauri::command]
pub async fn office_artifact_save_edit(
    app: AppHandle,
    from_id: String,
    png_base64: String,
) -> Result<Value, String> {
    use base64::Engine as _;
    let dir = artifacts_dir(&app).ok_or("the Office is not set up")?;
    let source = artifact_list(&dir)
        .into_iter()
        .find(|i| i["id"].as_str() == Some(from_id.as_str()))
        .ok_or("no such artifact")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.trim_start_matches("data:image/png;base64,"))
        .map_err(|e| format!("not a PNG: {e}"))?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err("not a PNG".into());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default();
    let id = format!("{now:x}-edit");
    let stem = source["file"]
        .as_str()
        .and_then(|f| f.rsplit('/').next())
        .and_then(|f| f.rsplit_once('.').map(|(stem, _)| stem.to_string()))
        .unwrap_or_else(|| "image".into());
    let name = format!("{stem}-edited.png");
    std::fs::create_dir_all(dir.join(&id)).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(&id).join(&name), &bytes).map_err(|e| e.to_string())?;
    let entry = json!({
        "id": id,
        "title": format!("{} (edited)", source["title"].as_str().unwrap_or("Image")),
        "note": "Edited in the app",
        "agentId": "",
        "agent": "You",
        "createdAt": now,
        "file": format!("{id}/{name}"),
        "kind": "image",
    });
    let index = dir.join("index.json");
    let mut list: Vec<Value> = std::fs::read(&index)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    list.push(entry.clone());
    let tmp = dir.join("index.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &index).map_err(|e| e.to_string())?;
    let _ = app.emit(ARTIFACT_EVENT, &entry);
    Ok(entry)
}

/// Open an artifact's file in its own app (PowerPoint, Word, a video player).
#[tauri::command]
pub async fn office_artifact_open(app: AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = artifacts_dir(&app).ok_or("the Office is not set up")?;
    let item = artifact_list(&dir)
        .into_iter()
        .find(|i| i["id"].as_str() == Some(id.as_str()))
        .ok_or("no such artifact")?;
    let path = item["path"].as_str().ok_or("this artifact has no file")?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

// ─── Notes for every server (Settings → Memory & skills) ────────────────────

/// `<app data>/global-memory.md`: notes every server's agents read. Each
/// Office's bridge mirrors it into its vault and points its agents at it.
fn global_memory_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("global-memory.md"))
}

#[tauri::command]
pub async fn global_memory_get(app: AppHandle) -> Result<String, String> {
    match std::fs::read_to_string(global_memory_path(&app)?) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn global_memory_set(app: AppHandle, text: String) -> Result<(), String> {
    let path = global_memory_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ─── The office vault (Memory tab) ──────────────────────────────────────────

/// The active Office's Obsidian vault (`<hive>/vault`, kept by the bridge).
fn vault_dir(app: &AppHandle) -> Option<PathBuf> {
    Some(artifacts_dir(app)?.parent()?.parent()?.join("vault"))
}

fn count_notes(dir: &std::path::Path, depth: usize) -> usize {
    if depth > 6 {
        return 0;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "graphify-out" {
                0
            } else if e.path().is_dir() {
                count_notes(&e.path(), depth + 1)
            } else {
                usize::from(name.ends_with(".md"))
            }
        })
        .sum()
}

/// The vault: where it is, how many notes, and its graphify graph if built.
#[tauri::command]
pub async fn office_vault(app: AppHandle) -> Result<Value, String> {
    let Some(vault) = vault_dir(&app) else {
        return Ok(json!({ "exists": false }));
    };
    if !vault.is_dir() {
        return Ok(json!({ "exists": false, "path": vault }));
    }
    let out = vault.join("graphify-out");
    let _ = app.asset_protocol_scope().allow_directory(&out, true);
    let graph = out.join("graph.html");
    let built = std::fs::metadata(&graph)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Ok(json!({
        "exists": true,
        "path": vault,
        "notes": count_notes(&vault, 0),
        "graphHtml": built.map(|_| graph.to_string_lossy().into_owned()),
        "graphBuiltAt": built,
    }))
}

/// Open the vault in Obsidian, or its folder.
#[tauri::command]
pub async fn office_vault_open(app: AppHandle, target: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let vault = vault_dir(&app).filter(|v| v.is_dir()).ok_or("the vault isn't set up yet")?;
    let path = vault.to_string_lossy().into_owned();
    match target.as_str() {
        "obsidian" => {
            // Form encoding writes spaces as '+' (a real '+' is %2B); Obsidian wants %20.
            let encoded = url::form_urlencoded::byte_serialize(path.as_bytes())
                .collect::<String>()
                .replace('+', "%20");
            app.opener()
                .open_url(format!("obsidian://open?path={encoded}"), None::<&str>)
                .map_err(|e| format!("couldn't open Obsidian (is it installed?): {e}"))
        }
        "folder" => app
            .opener()
            .open_path(path, None::<&str>)
            .map_err(|e| e.to_string()),
        other => Err(format!("unknown target: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_paths_inside_the_folder_are_resolved() {
        let dir = std::path::Path::new("/hive/shared/artifacts");
        assert!(inside(dir, "abc/deck.pdf").is_some());
        assert!(inside(dir, "../secret.txt").is_none());
        assert!(inside(dir, "/etc/passwd").is_none());
        assert!(inside(dir, "").is_none());
    }

    #[test]
    fn the_browser_only_opens_web_pages() {
        assert!(web_url("https://example.com").is_ok());
        assert!(web_url("http://localhost:5173").is_ok());
        assert!(web_url("file:///C:/Windows").is_err());
        assert!(web_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn artifacts_list_newest_first_with_paths() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("index.json"),
            r#"[{"id":"a","file":"a/one.pdf"},{"id":"b","url":"https://x.test","file":"../bad"}]"#,
        )
        .unwrap();
        let items = artifact_list(tmp.path());
        assert_eq!(items[0]["id"], "b");
        assert!(items[0].get("path").is_none(), "a path outside is never resolved");
        assert!(items[1]["path"].as_str().unwrap().ends_with("one.pdf"));
    }
}
