//! A copy of the webview's load-bearing localStorage (your servers, the
//! active one, "setup done" markers, preferences) kept on disk. The webview
//! can lose its storage (a forced quit mid-write left it empty once, showing
//! the first-run screen with the identity still in place); the app restores
//! from this copy at startup when it finds the storage wiped.

use tauri::{AppHandle, Manager};

fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("local-state-backup.json"))
}

#[tauri::command]
pub fn local_state_backup_save(app: AppHandle, json: String) -> Result<(), String> {
    // Only ever a JSON object of strings; refuse anything else.
    let parsed: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("not JSON: {e}"))?;
    if !parsed.is_object() {
        return Err("expected an object".into());
    }
    crate::managed_agents::storage::atomic_write_json(&path(&app)?, json.as_bytes())
}

#[tauri::command]
pub fn local_state_backup_load(app: AppHandle) -> Result<Option<String>, String> {
    let file = path(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    let bytes = crate::managed_agents::storage::read_store_bytes(&file)
        .map_err(|e| e.to_string())?;
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}
