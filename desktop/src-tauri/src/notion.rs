//! Notion for the Tasks page: the Office's task board syncs two ways with a
//! Notion database, and the owner's own task sheet lives in a second one.
//!
//! Buzz holds the integration token (OS keyring, never in a file or the
//! webview) and makes every API call. The sync and sheet logic run in the
//! frontend over `notion_request`, which reaches only the Notion API paths
//! those features use. The databases' ids and the sync bookkeeping live in the
//! app data dir.

use std::path::PathBuf;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const TOKEN_KEY: &str = "notion.integration-token";
const API_BASE: &str = "https://api.notion.com/v1/";
const API_VERSION: &str = "2022-06-28";

/// API paths the Tasks features call, relative to `API_BASE`.
static ALLOWED_PATH: LazyLock<regex::Regex> = LazyLock::new(|| {
    let id = "[0-9a-fA-F-]{32,36}";
    regex::Regex::new(&format!(
        "^(users/me|search|databases|databases/{id}|databases/{id}/query|pages|pages/{id})$"
    ))
    .expect("valid regex")
});

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionConfig {
    /// The integration's workspace, for display.
    pub workspace: Option<String>,
    /// The page the databases were created under.
    pub parent_page: Option<String>,
    /// The Office's task board.
    pub office_db: Option<String>,
    /// The owner's own task sheet.
    pub my_db: Option<String>,
    /// Which columns of `my_db` hold the task's fields, when the owner chose
    /// a database they already had (absent for the one Buzz creates).
    #[serde(default)]
    pub my_map: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionStatus {
    connected: bool,
    config: NotionConfig,
}

fn store() -> &'static crate::secret_store::SecretStore {
    crate::secret_store::SecretStore::shared(crate::app_state::keyring_service())
}

fn data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir.join(name))
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_json(path: &PathBuf, value: &impl Serialize) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("save {}: {e}", path.display()))
}

async fn call(
    token: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let mut request = client
        .request(method, format!("{API_BASE}{path}"))
        .bearer_auth(token)
        .header("Notion-Version", API_VERSION);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Notion unreachable: {e}"))?;
    let status = response.status();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(value);
    }
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("request failed");
    Err(format!("Notion {}: {message}", status.as_u16()))
}

/// Whether Notion is connected, and the databases set up for it.
#[tauri::command]
pub fn notion_status(app: AppHandle) -> Result<NotionStatus, String> {
    let connected = store().load(TOKEN_KEY)?.is_some();
    Ok(NotionStatus {
        connected,
        config: read_json(&data_file(&app, "notion.json")?),
    })
}

/// Check an internal integration token with Notion and keep it in the keyring.
#[tauri::command]
pub async fn notion_connect(app: AppHandle, token: String) -> Result<NotionStatus, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Paste the integration's secret.".into());
    }
    let me = call(&token, reqwest::Method::GET, "users/me", None).await?;
    let workspace = me
        .pointer("/bot/workspace_name")
        .and_then(Value::as_str)
        .map(str::to_string);
    store().store(TOKEN_KEY, &token)?;
    let path = data_file(&app, "notion.json")?;
    let mut config: NotionConfig = read_json(&path);
    config.workspace = workspace;
    write_json(&path, &config)?;
    notion_status(app)
}

/// Forget the token, the databases' ids and the sync bookkeeping. The
/// databases themselves stay in Notion.
#[tauri::command]
pub fn notion_disconnect(app: AppHandle) -> Result<(), String> {
    store().delete(TOKEN_KEY)?;
    for name in ["notion.json", "notion-sync.json"] {
        let path = data_file(&app, name)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// Record the databases set up for the Tasks page.
#[tauri::command]
pub fn notion_save_config(app: AppHandle, config: NotionConfig) -> Result<(), String> {
    let path = data_file(&app, "notion.json")?;
    let mut current: NotionConfig = read_json(&path);
    current.parent_page = config.parent_page.or(current.parent_page);
    current.office_db = config.office_db.or(current.office_db);
    if config.my_db.is_some() {
        // A new sheet brings its own column map (or none, for Buzz's own).
        current.my_map = config.my_map;
    }
    current.my_db = config.my_db.or(current.my_db);
    write_json(&path, &current)
}

/// One Notion API call with the stored token. Only the paths the Tasks
/// features use are reachable.
#[tauri::command]
pub async fn notion_request(
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        other => return Err(format!("method {other} not allowed")),
    };
    if !ALLOWED_PATH.is_match(&path) {
        return Err(format!("path {path} not allowed"));
    }
    let token = store().load(TOKEN_KEY)?.ok_or("Notion isn't connected.")?;
    call(&token, method, &path, body).await
}

/// The sync's bookkeeping: which Notion page each task maps to and what both
/// sides looked like when they last matched.
#[tauri::command]
pub fn notion_sync_state_load(app: AppHandle) -> Result<Value, String> {
    let state: Option<Value> = read_json(&data_file(&app, "notion-sync.json")?);
    Ok(state.unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
pub fn notion_sync_state_save(app: AppHandle, state: Value) -> Result<(), String> {
    write_json(&data_file(&app, "notion-sync.json")?, &state)
}

#[cfg(test)]
mod tests {
    use super::ALLOWED_PATH;

    #[test]
    fn only_task_paths_are_reachable() {
        let id = "1234567890abcdef1234567890abcdef";
        let dashed = "12345678-90ab-cdef-1234-567890abcdef";
        for ok in [
            "users/me".to_string(),
            "search".into(),
            "databases".into(),
            format!("databases/{id}/query"),
            format!("pages/{dashed}"),
            "pages".into(),
        ] {
            assert!(ALLOWED_PATH.is_match(&ok), "{ok}");
        }
        for denied in [
            "users",
            "comments",
            "blocks/abc/children",
            "databases/../users",
            "pages/x",
            "https://evil.example/pages",
        ] {
            assert!(!ALLOWED_PATH.is_match(denied), "{denied}");
        }
    }
}
