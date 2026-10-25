//! Updates from the app's GitHub releases (Settings → Updates).
//!
//! Checking asks GitHub for the latest release and compares its version with
//! this build's. Updating downloads that release's installer for this
//! computer and hands over to it:
//!  - Windows: the setup program, in its passive mode (a progress bar, no
//!    questions), which replaces the app and starts it again (`/P /R`);
//!  - macOS: the disk image is mounted and its app copied over this one, then
//!    the app restarts;
//!  - Linux: an AppImage replaces itself and restarts; otherwise the `.deb`
//!    is opened with the system's installer.
//!
//! Updating automatically is off unless the owner turns it on
//! (`<app data>/updater.json`); then the app checks once a few seconds after it
//! starts and the window offers the update with a short countdown.

use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const LATEST_RELEASE: &str = "https://api.github.com/repos/KenFromBarbie/Anything/releases/latest";
const SETTINGS_FILE: &str = "updater.json";

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSettings {
    /// Install new releases without being asked (off unless chosen).
    pub auto: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub notes: String,
    pub url: String,
    /// The installer that would be downloaded, when there's one for this
    /// computer.
    pub asset: Option<String>,
    pub size: u64,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize, Clone)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(SETTINGS_FILE))
}

fn read_settings(app: &AppHandle) -> UpdaterSettings {
    settings_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// `0.7.8` / `v0.7.8` → (0, 7, 8); missing parts count as 0, anything after
/// a `-` (a pre-release) is ignored.
fn version_parts(version: &str) -> (u64, u64, u64) {
    let core = version.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next().unwrap_or("");
    let mut parts = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

fn is_newer(latest: &str, current: &str) -> bool {
    version_parts(latest) > version_parts(current)
}

/// The release file that installs on this computer.
fn pick_asset(assets: &[Asset]) -> Option<Asset> {
    let find = |suffix: &str| {
        assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(suffix))
            .cloned()
    };
    if cfg!(target_os = "windows") {
        find("-setup.exe").or_else(|| find(".msi"))
    } else if cfg!(target_os = "macos") {
        find(".dmg")
    } else if std::env::var_os("APPIMAGE").is_some() {
        find(".appimage")
    } else {
        find(".deb").or_else(|| find(".appimage"))
    }
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Anything/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

async fn latest_release() -> Result<Release, String> {
    let response = http()?
        .get(LATEST_RELEASE)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("couldn't reach GitHub: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("GitHub answered {}", response.status()));
    }
    response
        .json::<Release>()
        .await
        .map_err(|e| format!("couldn't read the release: {e}"))
}

fn info(app: &AppHandle, release: &Release) -> UpdateInfo {
    let current = app.package_info().version.to_string();
    let asset = pick_asset(&release.assets);
    UpdateInfo {
        available: is_newer(&release.tag_name, &current),
        latest: release.tag_name.trim_start_matches('v').to_string(),
        current,
        notes: release.body.clone().unwrap_or_default(),
        url: release.html_url.clone(),
        size: asset.as_ref().map(|a| a.size).unwrap_or(0),
        asset: asset.map(|a| a.name),
    }
}

#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<UpdateInfo, String> {
    Ok(info(&app, &latest_release().await?))
}

#[tauri::command]
pub fn updater_settings_get(app: AppHandle) -> UpdaterSettings {
    read_settings(&app)
}

#[tauri::command]
pub fn updater_settings_set(app: AppHandle, auto: bool) -> Result<UpdaterSettings, String> {
    let settings = UpdaterSettings { auto };
    let file = settings_path(&app).ok_or("no app data folder")?;
    let json = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    crate::managed_agents::storage::atomic_write_json(&file, &json)?;
    Ok(settings)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: u64,
}

/// Download the latest release's installer for this computer and install it.
/// The app quits (and comes back) as part of it.
#[tauri::command]
pub async fn updater_install(app: AppHandle) -> Result<(), String> {
    let release = latest_release().await?;
    let current = app.package_info().version.to_string();
    if !is_newer(&release.tag_name, &current) {
        return Err("This is already the latest version.".into());
    }
    let asset = pick_asset(&release.assets)
        .ok_or("This release has no installer for this computer; download it from GitHub.")?;
    let dir = std::env::temp_dir().join("anything-update");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(&asset.name);
    download(&app, &asset, &file).await?;
    install(&app, &file)
}

async fn download(app: &AppHandle, asset: &Asset, file: &Path) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let response = http()?
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download failed: {}", response.status()));
    }
    let total = response.content_length().unwrap_or(asset.size);
    let mut out = tokio::fs::File::create(file)
        .await
        .map_err(|e| format!("couldn't save the download: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut downloaded = 0u64;
    let mut last_report = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download failed: {e}"))?;
        out.write_all(&chunk)
            .await
            .map_err(|e| format!("couldn't save the download: {e}"))?;
        downloaded += chunk.len() as u64;
        if downloaded - last_report >= 1 << 20 || downloaded == total {
            last_report = downloaded;
            let _ = app.emit("updater-progress", Progress { downloaded, total });
        }
    }
    out.flush().await.map_err(|e| e.to_string())?;
    if asset.size > 0 && downloaded != asset.size {
        return Err(format!(
            "the download is incomplete ({downloaded} of {} bytes); try again",
            asset.size
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn install(app: &AppHandle, file: &Path) -> Result<(), String> {
    // Passive (progress only, no questions) and start the app again after.
    std::process::Command::new(file)
        .args(["/P", "/R"])
        .spawn()
        .map_err(|e| format!("couldn't start the installer: {e}"))?;
    // The installer replaces the running app: get out of its way.
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "macos")]
fn install(app: &AppHandle, file: &Path) -> Result<(), String> {
    use std::process::Command;
    // This app's bundle: …/Anything.app/Contents/MacOS/anything.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .ok_or("couldn't find the app bundle to replace")?
        .to_path_buf();
    let mount = file.with_extension("mount");
    let status = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-quiet", "-mountpoint"])
        .arg(&mount)
        .arg(file)
        .status()
        .map_err(|e| format!("couldn't open the disk image: {e}"))?;
    if !status.success() {
        return Err("couldn't open the disk image".into());
    }
    let result = (|| {
        let new_app = std::fs::read_dir(&mount)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.extension().is_some_and(|e| e == "app"))
            .ok_or("the disk image has no app in it")?;
        let staged = bundle.with_extension("app.new");
        let _ = std::fs::remove_dir_all(&staged);
        let copied = Command::new("ditto")
            .arg(&new_app)
            .arg(&staged)
            .status()
            .map_err(|e| e.to_string())?;
        if !copied.success() {
            return Err("couldn't copy the new app".to_string());
        }
        let old = bundle.with_extension("app.old");
        let _ = std::fs::remove_dir_all(&old);
        std::fs::rename(&bundle, &old).map_err(|e| format!("couldn't replace the app: {e}"))?;
        if let Err(e) = std::fs::rename(&staged, &bundle) {
            let _ = std::fs::rename(&old, &bundle);
            return Err(format!("couldn't replace the app: {e}"));
        }
        let _ = std::fs::remove_dir_all(&old);
        Ok(())
    })();
    let _ = Command::new("hdiutil")
        .args(["detach", "-quiet"])
        .arg(&mount)
        .status();
    result?;
    app.restart();
}

#[cfg(all(unix, not(target_os = "macos")))]
fn install(app: &AppHandle, file: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(current) = std::env::var_os("APPIMAGE").map(PathBuf::from) {
        if file.extension().is_some_and(|e| e.eq_ignore_ascii_case("appimage")) {
            let staged = current.with_extension("AppImage.new");
            std::fs::copy(file, &staged).map_err(|e| format!("couldn't stage the update: {e}"))?;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
            std::fs::rename(&staged, &current)
                .map_err(|e| format!("couldn't replace the app: {e}"))?;
            std::process::Command::new(&current)
                .spawn()
                .map_err(|e| format!("couldn't start the new version: {e}"))?;
            app.exit(0);
            return Ok(());
        }
    }
    // A .deb: the system's installer takes it from here.
    std::process::Command::new("xdg-open")
        .arg(file)
        .spawn()
        .map_err(|e| format!("couldn't open the installer: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_by_number() {
        assert!(is_newer("v0.7.10", "0.7.9"));
        assert!(is_newer("0.8.0", "0.7.99"));
        assert!(!is_newer("v0.7.8", "0.7.8"));
        assert!(!is_newer("0.7.7", "0.7.8"));
        assert_eq!(version_parts("v1.2.3-beta.1"), (1, 2, 3));
    }

    #[test]
    fn picks_this_computers_installer() {
        let asset = |name: &str| Asset {
            name: name.into(),
            browser_download_url: String::new(),
            size: 1,
        };
        let assets = vec![
            asset("anything_0.7.8_aarch64.dmg"),
            asset("anything_0.7.8_amd64.AppImage"),
            asset("anything_0.7.8_amd64.deb"),
            asset("anything_0.7.8_x64-setup.exe"),
            asset("studio-app-0.7.8.zip"),
        ];
        let picked = pick_asset(&assets).map(|a| a.name);
        if cfg!(target_os = "windows") {
            assert_eq!(picked.as_deref(), Some("anything_0.7.8_x64-setup.exe"));
        } else if cfg!(target_os = "macos") {
            assert_eq!(picked.as_deref(), Some("anything_0.7.8_aarch64.dmg"));
        } else {
            assert!(picked.is_some());
        }
    }
}
