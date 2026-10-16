//! Research projects: folders on disk the owner and the agents research in.
//! A project is a folder (made under the research root, or an existing one
//! added), plus a name, a description, a pin, a cover image and the Buzz
//! channel its chat happens in. The list lives in `<app data>/research.json`;
//! a project's cover is copied into its folder (`.buzz/cover.<ext>`).
//! Removing a project only takes it off the list — the folder stays.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"];
const MAX_IMAGE_BYTES: u64 = 15 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
    name: String,
    path: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    channel_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    #[serde(default)]
    root: Option<String>,
    #[serde(default)]
    projects: Vec<Project>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    project: Project,
    exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchState {
    root: String,
    projects: Vec<ProjectView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    is_dir: bool,
    size: u64,
    modified: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    name: Option<String>,
    description: Option<String>,
    pinned: Option<bool>,
    channel_id: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir.join("research.json"))
}

fn load(app: &AppHandle) -> Registry {
    registry_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, registry: &Registry) -> Result<(), String> {
    let path = registry_path(app)?;
    let tmp = path.with_extension("tmp");
    let text = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("save {}: {e}", path.display()))
}

fn default_root() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join("Research")
}

fn root_of(registry: &Registry) -> PathBuf {
    registry
        .root
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_root)
}

/// A folder name from a project name: letters, digits, spaces and dashes.
fn folder_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                ' '
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed.chars().take(60).collect();
    if trimmed.is_empty() {
        "Untitled project".into()
    } else {
        trimmed
    }
}

fn view(project: Project) -> ProjectView {
    let exists = Path::new(&project.path).is_dir();
    ProjectView { project, exists }
}

fn state(registry: Registry) -> ResearchState {
    let root = root_of(&registry).to_string_lossy().into_owned();
    let mut projects: Vec<Project> = registry.projects;
    projects.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(b.updated_at.cmp(&a.updated_at))
    });
    ResearchState {
        root,
        projects: projects.into_iter().map(view).collect(),
    }
}

fn find<'a>(registry: &'a mut Registry, id: &str) -> Result<&'a mut Project, String> {
    registry
        .projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "That project isn't in Research anymore.".to_string())
}

#[tauri::command]
pub fn research_list(app: AppHandle) -> ResearchState {
    state(load(&app))
}

/// Start a project: a new folder under the research root, with a README
/// holding its brief.
#[tauri::command]
pub fn research_create(
    app: AppHandle,
    name: String,
    description: String,
) -> Result<ProjectView, String> {
    let mut registry = load(&app);
    let root = root_of(&registry);
    std::fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
    let base = folder_name(&name);
    let mut dir = root.join(&base);
    let mut n = 2;
    while dir.exists() {
        dir = root.join(format!("{base} {n}"));
        n += 1;
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let title = name.trim();
    let readme = format!(
        "# {}\n\n{}\n",
        if title.is_empty() { &base } else { title },
        description.trim()
    );
    std::fs::write(dir.join("README.md"), readme).map_err(|e| format!("write README: {e}"))?;
    let now = now_ms();
    let project = Project {
        id: format!("rp-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]),
        name: if title.is_empty() {
            base
        } else {
            title.to_string()
        },
        path: dir.to_string_lossy().into_owned(),
        description: description.trim().to_string(),
        pinned: false,
        image: None,
        channel_id: None,
        created_at: now,
        updated_at: now,
    };
    registry.projects.push(project.clone());
    save(&app, &registry)?;
    Ok(view(project))
}

/// Add an existing folder as a project.
#[tauri::command]
pub fn research_add_folder(app: AppHandle, path: String) -> Result<ProjectView, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err("That folder doesn't exist.".into());
    }
    let mut registry = load(&app);
    if let Some(existing) = registry.projects.iter().find(|p| Path::new(&p.path) == dir) {
        return Ok(view(existing.clone()));
    }
    let now = now_ms();
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    let project = Project {
        id: format!("rp-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]),
        name,
        path: dir.to_string_lossy().into_owned(),
        description: String::new(),
        pinned: false,
        image: None,
        channel_id: None,
        created_at: now,
        updated_at: now,
    };
    registry.projects.push(project.clone());
    save(&app, &registry)?;
    Ok(view(project))
}

#[tauri::command]
pub fn research_update(
    app: AppHandle,
    id: String,
    patch: ProjectPatch,
) -> Result<ProjectView, String> {
    let mut registry = load(&app);
    let project = find(&mut registry, &id)?;
    if let Some(name) = patch.name {
        let name = name.trim();
        if name.is_empty() {
            return Err("Give the project a name.".into());
        }
        project.name = name.to_string();
    }
    if let Some(description) = patch.description {
        project.description = description.trim().to_string();
    }
    if let Some(pinned) = patch.pinned {
        project.pinned = pinned;
    }
    if let Some(channel) = patch.channel_id {
        project.channel_id = if channel.is_empty() {
            None
        } else {
            Some(channel)
        };
    }
    project.updated_at = now_ms();
    let updated = project.clone();
    save(&app, &registry)?;
    Ok(view(updated))
}

const MAX_ATTACHMENT_BYTES: usize = 200 * 1024 * 1024;

/// A file name that stays inside its folder: no separators, no `..`, no
/// characters Windows refuses.
fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

/// `dir/name`, or `dir/name (2).ext` etc. when that's taken.
fn free_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("a free name")
}

/// Save an attached file into the project's `sources/` folder. The file's
/// bytes are the raw request body; `x-project` and `x-name` (URI-encoded)
/// headers say where. Returns the path relative to the project folder.
#[tauri::command]
pub fn research_save_file(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Expected the file's bytes.".into());
    };
    if data.len() > MAX_ATTACHMENT_BYTES {
        return Err("That file is over 200 MB.".into());
    }
    let header = |key: &str| {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let id = header("x-project").ok_or("Missing project.")?;
    let raw_name = header("x-name").unwrap_or_default();
    let name = safe_file_name(
        &percent_encoding::percent_decode_str(&raw_name)
            .decode_utf8()
            .map(|n| n.into_owned())
            .unwrap_or_else(|_| raw_name.clone()),
    );
    let mut registry = load(&app);
    let project = find(&mut registry, &id)?;
    let dir = PathBuf::from(&project.path).join("sources");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = free_path(&dir, &name);
    std::fs::write(&path, data).map_err(|e| format!("save {}: {e}", path.display()))?;
    let file = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(name);
    Ok(format!("sources/{file}"))
}

async fn pick_path(app: &AppHandle, folder: bool, images: bool) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if images {
        dialog = dialog.add_filter("Images", IMAGE_EXTENSIONS);
    }
    if folder {
        dialog.pick_folder(move |path| {
            let _ = tx.send(path);
        });
    } else {
        dialog.pick_file(move |path| {
            let _ = tx.send(path);
        });
    }
    let picked = rx.await.ok()??;
    Some(picked.as_path()?.to_string_lossy().into_owned())
}

/// Choose a cover image with the system picker. `None` when cancelled.
#[tauri::command]
pub async fn research_pick_image(
    app: AppHandle,
    id: String,
) -> Result<Option<ProjectView>, String> {
    match pick_path(&app, false, true).await {
        Some(source) => research_set_image(app, id, source).map(Some),
        None => Ok(None),
    }
}

/// Add an existing folder, chosen with the system picker. `None` when cancelled.
#[tauri::command]
pub async fn research_pick_folder(app: AppHandle) -> Result<Option<ProjectView>, String> {
    match pick_path(&app, true, false).await {
        Some(path) => research_add_folder(app, path).map(Some),
        None => Ok(None),
    }
}

/// Choose where new projects are created. `None` when cancelled.
#[tauri::command]
pub async fn research_pick_root(app: AppHandle) -> Result<Option<ResearchState>, String> {
    match pick_path(&app, true, false).await {
        Some(path) => research_set_root(app, path).map(Some),
        None => Ok(None),
    }
}

/// Use an image file as the project's cover (copied into the project folder).
#[tauri::command]
pub fn research_set_image(
    app: AppHandle,
    id: String,
    source: String,
) -> Result<ProjectView, String> {
    let source = PathBuf::from(&source);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| IMAGE_EXTENSIONS.contains(&e.as_str()))
        .ok_or("Pick an image (PNG, JPG, GIF, WebP, AVIF, BMP or SVG).")?;
    let size = std::fs::metadata(&source)
        .map_err(|e| format!("read {}: {e}", source.display()))?
        .len();
    if size > MAX_IMAGE_BYTES {
        return Err("That image is over 15 MB.".into());
    }
    let mut registry = load(&app);
    let project = find(&mut registry, &id)?;
    let dir = Path::new(&project.path).join(".buzz");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let target = dir.join(format!("cover.{ext}"));
    std::fs::copy(&source, &target).map_err(|e| format!("copy the image: {e}"))?;
    // An older cover with another extension is no longer used.
    if let Some(old) = project.image.as_ref().map(PathBuf::from) {
        if old != target && old.starts_with(&dir) {
            let _ = std::fs::remove_file(old);
        }
    }
    project.image = Some(target.to_string_lossy().into_owned());
    project.updated_at = now_ms();
    let updated = project.clone();
    save(&app, &registry)?;
    Ok(view(updated))
}

#[tauri::command]
pub fn research_clear_image(app: AppHandle, id: String) -> Result<ProjectView, String> {
    let mut registry = load(&app);
    let project = find(&mut registry, &id)?;
    project.image = None;
    project.updated_at = now_ms();
    let updated = project.clone();
    save(&app, &registry)?;
    Ok(view(updated))
}

/// A project's cover as a data URL, for the webview.
#[tauri::command]
pub fn research_image(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let registry = load(&app);
    let Some(project) = registry.projects.iter().find(|p| p.id == id) else {
        return Ok(None);
    };
    let Some(path) = project.image.as_ref().map(PathBuf::from) else {
        return Ok(None);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    };
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )))
}

/// Take a project off the list. Its folder is left as it is.
#[tauri::command]
pub fn research_remove(app: AppHandle, id: String) -> Result<(), String> {
    let mut registry = load(&app);
    registry.projects.retain(|p| p.id != id);
    save(&app, &registry)
}

/// Where new projects' folders are made.
#[tauri::command]
pub fn research_set_root(app: AppHandle, path: String) -> Result<ResearchState, String> {
    let dir = PathBuf::from(&path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let mut registry = load(&app);
    registry.root = Some(dir.to_string_lossy().into_owned());
    save(&app, &registry)?;
    Ok(state(registry))
}

/// What's in a project's folder (top level), newest first.
#[tauri::command]
pub fn research_files(app: AppHandle, id: String) -> Result<Vec<FileEntry>, String> {
    let registry = load(&app);
    let project = registry
        .projects
        .iter()
        .find(|p| p.id == id)
        .ok_or("That project isn't in Research anymore.")?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&project.path)
        .map_err(|e| format!("read {}: {e}", project.path))?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        entries.push(FileEntry {
            name,
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified: meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(entries)
}

/// Open a project's folder (or a file in it) in the system's file manager / app.
#[tauri::command]
pub fn research_open(app: AppHandle, id: String, file: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let registry = load(&app);
    let project = registry
        .projects
        .iter()
        .find(|p| p.id == id)
        .ok_or("That project isn't in Research anymore.")?;
    let mut target = PathBuf::from(&project.path);
    if let Some(name) = file {
        // Only a direct child of the project folder (":" would make a
        // drive-relative path on Windows).
        if name.contains(['/', '\\', ':']) || name == ".." || name == "." {
            return Err("invalid file name".into());
        }
        target = target.join(name);
        // Agents write into project folders: never launch a program or script
        // from a click; show it in the file manager instead.
        if is_runnable(&target) {
            return app
                .opener()
                .reveal_item_in_dir(&target)
                .map_err(|e| format!("Couldn't show it: {e}"));
        }
    }
    app.opener()
        .open_path(target.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open it: {e}"))
}

/// Files the OS would run rather than open in a viewer.
fn is_runnable(path: &Path) -> bool {
    const RUNNABLE: &[&str] = &[
        "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
        "msi", "msp", "scr", "pif", "lnk", "url", "hta", "cpl", "jar", "reg", "sh", "bash",
        "zsh", "command", "app", "pkg", "dmg", "run", "appimage", "desktop", "py", "pyw",
    ];
    if path.is_dir() {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext {
        Some(ext) => RUNNABLE.contains(&ext.as_str()),
        // No extension: an executable on macOS/Linux if its mode says so.
        None => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::metadata(path)
                    .map(|m| m.permissions().mode() & 0o111 != 0)
                    .unwrap_or(false)
            }
            #[cfg(not(unix))]
            {
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programs_and_scripts_are_not_launched() {
        let dir = std::env::temp_dir();
        for name in ["setup.exe", "run.BAT", "x.ps1", "a.lnk", "b.sh", "c.js"] {
            assert!(is_runnable(&dir.join(name)), "{name}");
        }
        for name in ["notes.md", "report.pdf", "data.csv", "cover.png"] {
            assert!(!is_runnable(&dir.join(name)), "{name}");
        }
    }

    #[test]
    fn attachment_names_stay_in_their_folder() {
        assert_eq!(safe_file_name("..\\..\\evil.txt"), "evil.txt");
        assert_eq!(safe_file_name("a/b/c?.pdf"), "c_.pdf");
        assert_eq!(safe_file_name(".."), "attachment");
        assert_eq!(safe_file_name("  notes.md "), "notes.md");
    }

    #[test]
    fn folder_names_are_safe() {
        assert_eq!(
            folder_name("EV charging: market/size?"),
            "EV charging market size"
        );
        assert_eq!(folder_name("   "), "Untitled project");
        assert_eq!(folder_name("..\\..\\etc"), "etc");
    }
}
