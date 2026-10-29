//! Components: the large parts of the app that aren't in the installer, and
//! are downloaded the first time they're needed instead.
//!
//! - `office`: the Office runtime (its code, modules and Node), the first
//!   time the Office opens.
//! - `hosting`: the hosting kit (relay, Postgres, Garnet), the first time a
//!   server is made on this computer.
//!
//! Each release publishes them next to the installers, per platform, as
//! `anything-<name>-<version>-<platform>.zip` with a `.sha256` beside it.
//! A component is checked against that hash, unpacked into
//! `<app data>/components/<name>-<version>/`, and marked ready; an update to
//! the app fetches its own version the next time it's needed. An installer
//! that still carries a component (older builds, development) is used as is.

use std::io::Read;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

const RELEASES_URL: &str = "https://github.com/KenFromBarbie/Anything/releases/download";
const PROGRESS_EVENT: &str = "component-progress";
const READY_MARK: &str = ".ready";
/// No component is near this; a bigger download is refused.
const MAX_DOWNLOAD_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Component {
    Office,
    Hosting,
}

impl Component {
    pub fn name(self) -> &'static str {
        match self {
            Component::Office => "office",
            Component::Hosting => "hosting",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "office" => Some(Component::Office),
            "hosting" => Some(Component::Hosting),
            _ => None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    name: &'static str,
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

/// This build's platform, as the release names it.
pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows-x64"
    } else if cfg!(target_os = "macos") {
        "macos-arm64"
    } else {
        "linux-x64"
    }
}

/// The release file for a component of this version and platform.
pub fn asset_name(component: Component, version: &str) -> String {
    format!(
        "anything-{}-{version}-{}.zip",
        component.name(),
        platform()
    )
}

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("components"))
}

fn dir_for(app: &AppHandle, component: Component) -> Result<PathBuf, String> {
    Ok(root(app)?.join(format!("{}-{}", component.name(), version(app))))
}

/// The component's folder if it's downloaded and ready (never downloads).
pub fn ready(app: &AppHandle, component: Component) -> Option<PathBuf> {
    let dir = dir_for(app, component).ok()?;
    dir.join(READY_MARK).is_file().then_some(dir)
}

/// The component's folder, downloading it first if needed (with progress
/// events for the page that's waiting).
pub async fn ensure(app: &AppHandle, component: Component) -> Result<PathBuf, String> {
    if let Some(dir) = ready(app, component) {
        return Ok(dir);
    }
    let dir = dir_for(app, component)?;
    let base = std::env::var("BUZZ_COMPONENTS_URL").unwrap_or_else(|_| {
        format!("{RELEASES_URL}/v{}", version(app))
    });
    let asset = asset_name(component, &version(app));
    let report = |phase: &'static str, received: u64, total: Option<u64>| {
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress { name: component.name(), phase, received, total },
        );
    };

    let client = reqwest::Client::builder()
        .user_agent(concat!("Anything/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let expected = client
        .get(format!("{base}/{asset}.sha256"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("couldn't get the {} download's checksum: {e}", component.name()))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let expected = expected
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if expected.len() != 64 {
        return Err(format!("the {} download's checksum is unreadable", component.name()));
    }

    let response = client
        .get(format!("{base}/{asset}"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("couldn't download the {}: {e}", component.name()))?;
    let total = response.content_length();
    if total.is_some_and(|t| t > MAX_DOWNLOAD_BYTES) {
        return Err(format!("the {} download is too large", component.name()));
    }
    let root = root(app)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let zip_path = root.join(format!("{asset}.part"));
    let mut hasher = Sha256::new();
    {
        use tokio::io::AsyncWriteExt;
        let mut out = tokio::fs::File::create(&zip_path)
            .await
            .map_err(|e| format!("couldn't save the download: {e}"))?;
        let mut stream = response.bytes_stream();
        let mut received = 0u64;
        let mut reported = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("the download stopped: {e}"))?;
            received += chunk.len() as u64;
            if received > MAX_DOWNLOAD_BYTES {
                return Err(format!("the {} download is too large", component.name()));
            }
            hasher.update(&chunk);
            out.write_all(&chunk)
                .await
                .map_err(|e| format!("couldn't save the download: {e}"))?;
            if received - reported >= 1 << 20 {
                reported = received;
                report("downloading", received, total);
            }
        }
        out.flush().await.map_err(|e| e.to_string())?;
    }
    let actual = hex(&hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&zip_path);
        return Err(format!(
            "the {} download didn't match its checksum; try again",
            component.name()
        ));
    }

    report("installing", 0, None);
    let staging = root.join(format!("{}-{}.unpacking", component.name(), version(app)));
    let unpack_from = zip_path.clone();
    let unpack_to = staging.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = std::fs::remove_dir_all(&unpack_to);
        unpack(&unpack_from, &unpack_to)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&zip_path);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&staging, &dir).map_err(|e| format!("couldn't finish installing: {e}"))?;
    std::fs::write(dir.join(READY_MARK), b"").map_err(|e| e.to_string())?;
    forget_older(&root, component, &dir);
    report("done", 0, None);
    Ok(dir)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Unpack a zip into `dest`, keeping every entry inside it and restoring the
/// executable bit on macOS and Linux (the runtime and the servers' programs).
fn unpack(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("the download isn't a valid archive: {e}"))?;
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
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode & 0o777));
        }
    }
    Ok(())
}

/// After an update, the previous versions of a component are only taking
/// space (the app's own downloads; nothing of the user's is in them).
fn forget_older(root: &Path, component: Component, keep: &Path) {
    let prefix = format!("{}-", component.name());
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path != keep && path.is_dir() && name.starts_with(&prefix) {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentStatus {
    ready: bool,
    /// The installer carries it (development, older builds): nothing to get.
    bundled: bool,
}

/// Whether a component is here (bundled or downloaded) or would download.
#[tauri::command]
pub async fn component_status(app: AppHandle, name: String) -> Result<ComponentStatus, String> {
    let component = Component::parse(&name).ok_or("unknown component")?;
    let bundled = match component {
        Component::Office => crate::office::bundled_office_dir(&app).is_some(),
        Component::Hosting => crate::hosting_kit::bundled(&app),
    };
    Ok(ComponentStatus { ready: bundled || ready(&app, component).is_some(), bundled })
}

/// Download a component now (the page shows `component-progress`).
#[tauri::command]
pub async fn component_install(app: AppHandle, name: String) -> Result<(), String> {
    let component = Component::parse(&name).ok_or("unknown component")?;
    ensure(&app, component).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_names_carry_component_version_and_platform() {
        let name = asset_name(Component::Office, "1.0.0");
        assert!(name.starts_with("anything-office-1.0.0-"));
        assert!(name.ends_with(".zip"));
        assert_eq!(Component::parse("hosting"), Some(Component::Hosting));
        assert_eq!(Component::parse("studio"), None);
    }

    #[test]
    fn unpack_keeps_files_inside_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("c.zip");
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts: zip::write::SimpleFileOptions = Default::default();
            zip.start_file("runtime/node", opts).unwrap();
            std::io::Write::write_all(&mut zip, b"bin").unwrap();
            zip.start_file("../escape.txt", opts).unwrap();
            std::io::Write::write_all(&mut zip, b"nope").unwrap();
            zip.finish().unwrap();
        }
        let dest = dir.path().join("out");
        unpack(&zip_path, &dest).unwrap();
        assert!(dest.join("runtime/node").is_file());
        assert!(!dir.path().join("escape.txt").exists());
    }
}
