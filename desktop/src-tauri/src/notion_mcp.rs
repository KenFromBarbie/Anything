//! Notion through the owner's own account. Buzz signs in to Notion's hosted
//! MCP server — OAuth 2.1 with PKCE and dynamic client registration, so there's
//! no developer setup and no secret shipped in the app — and calls its tools for
//! the Tasks page (the agents' board sync and My tasks).
//!
//! Tokens live in the OS keyring; the webview only ever sees tool results.
//! Access tokens are refreshed before they expire, one refresh at a time
//! (Notion rotates the refresh token on every use, and reusing a rotated one
//! revokes the grant).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Query, State as AxumState},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::{net::TcpListener, sync::oneshot};
use url::Url;

const MCP_URL: &str = "https://mcp.notion.com/mcp";
const PROTOCOL_VERSION: &str = "2025-06-18";
/// The loopback redirect registered with Notion. Fixed, because the
/// registration names one exact URI.
const REDIRECT_PORT: u16 = 47615;
const REDIRECT_PATH: &str = "/notion/callback";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

const CLIENT_KEY: &str = "notion.mcp.client";
const TOKENS_KEY: &str = "notion.mcp.tokens";

/// Tools the Tasks page may call.
const ALLOWED_TOOLS: &[&str] = &[
    "notion-get-self",
    "notion-search",
    "notion-fetch",
    "notion-create-pages",
    "notion-update-page",
    "notion-create-database",
    "notion-update-data-source",
    "notion-query-data-sources",
    "notion-move-pages",
];

const SIGNED_IN_HTML: &str = "<!doctype html><meta charset=utf-8><title>Buzz</title>\
<body style=\"font-family:system-ui;padding:48px;text-align:center\">\
<h2>Signed in to Notion</h2><p>You can close this window and return to Buzz.</p></body>";

#[derive(Clone, Serialize, Deserialize)]
struct ClientReg {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
    redirect_uri: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// Unix seconds.
    expires_at: u64,
}

#[derive(Clone, Deserialize)]
struct AuthServer {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    registration_endpoint: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    connected: bool,
    workspace: Option<String>,
    user: Option<String>,
}

fn store() -> &'static crate::secret_store::SecretStore {
    crate::secret_store::SecretStore::shared(crate::app_state::keyring_service())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn http() -> reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_default()
    });
    CLIENT.clone()
}

fn redirect_uri() -> String {
    format!("http://127.0.0.1:{REDIRECT_PORT}{REDIRECT_PATH}")
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_32() -> [u8; 32] {
    let mut out = [0u8; 32];
    out[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    out[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    out
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        s.append_pair(k, v);
    }
    s.finish()
}

fn load_json<T: for<'de> Deserialize<'de>>(key: &str) -> Option<T> {
    store()
        .load(key)
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn save_json(key: &str, value: &impl Serialize) -> Result<(), String> {
    store().store(
        key,
        &serde_json::to_string(value).map_err(|e| e.to_string())?,
    )
}

// ─── Discovery and registration ──────────────────────────────────────────────

async fn get_json(url: &str) -> Option<Value> {
    let response = http()
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

/// RFC 9728 → RFC 8414: from the MCP server's 401 (or its well-known
/// document) to the authorization server's endpoints.
async fn discover() -> Result<AuthServer, String> {
    let mut metadata_urls = Vec::new();
    if let Ok(response) = http()
        .post(MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(json!({"jsonrpc": "2.0", "id": 0, "method": "ping"}).to_string())
        .send()
        .await
    {
        if let Some(header) = response
            .headers()
            .get("www-authenticate")
            .and_then(|h| h.to_str().ok())
        {
            if let Some(start) = header.find("resource_metadata=\"") {
                let rest = &header[start + 19..];
                if let Some(end) = rest.find('"') {
                    metadata_urls.push(rest[..end].to_string());
                }
            }
        }
    }
    metadata_urls.push("https://mcp.notion.com/.well-known/oauth-protected-resource/mcp".into());
    metadata_urls.push("https://mcp.notion.com/.well-known/oauth-protected-resource".into());

    let mut issuers = Vec::new();
    for url in &metadata_urls {
        if let Some(doc) = get_json(url).await {
            if let Some(list) = doc.get("authorization_servers").and_then(Value::as_array) {
                issuers.extend(list.iter().filter_map(Value::as_str).map(String::from));
            }
            if !issuers.is_empty() {
                break;
            }
        }
    }
    issuers.push("https://mcp.notion.com".into());

    for issuer in issuers {
        let Ok(base) = Url::parse(&issuer) else {
            continue;
        };
        let origin = base.origin().ascii_serialization();
        let path = base.path().trim_end_matches('/');
        let mut candidates = vec![format!(
            "{origin}/.well-known/oauth-authorization-server{path}"
        )];
        if !path.is_empty() {
            candidates.push(format!("{issuer}/.well-known/oauth-authorization-server"));
        }
        candidates.push(format!("{origin}/.well-known/openid-configuration{path}"));
        for candidate in candidates {
            if let Some(doc) = get_json(&candidate).await {
                if let Ok(server) = serde_json::from_value::<AuthServer>(doc) {
                    return Ok(server);
                }
            }
        }
    }
    Err("Couldn't reach Notion's sign-in service.".into())
}

async fn client_registration(server: &AuthServer) -> Result<ClientReg, String> {
    if let Some(existing) = load_json::<ClientReg>(CLIENT_KEY) {
        if existing.redirect_uri == redirect_uri() {
            return Ok(existing);
        }
    }
    let endpoint = server
        .registration_endpoint
        .as_deref()
        .ok_or("Notion's sign-in service doesn't accept new apps right now.")?;
    let response = http()
        .post(endpoint)
        .json(&json!({
            "client_name": "Buzz",
            "redirect_uris": [redirect_uri()],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }))
        .send()
        .await
        .map_err(|e| format!("Notion unreachable: {e}"))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(format!(
            "Notion refused to register Buzz ({}): {}",
            status.as_u16(),
            body.get("error_description")
                .or_else(|| body.get("error"))
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
        ));
    }
    let reg = ClientReg {
        client_id: body
            .get("client_id")
            .and_then(Value::as_str)
            .ok_or("Notion's registration answer had no client id.")?
            .to_string(),
        client_secret: body
            .get("client_secret")
            .and_then(Value::as_str)
            .map(String::from),
        redirect_uri: redirect_uri(),
    };
    save_json(CLIENT_KEY, &reg)?;
    Ok(reg)
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

fn tokens_from(body: &Value, previous_refresh: Option<String>) -> Result<Tokens, String> {
    let access_token = body
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("Notion's answer had no access token.")?
        .to_string();
    let expires_in = body
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3600);
    Ok(Tokens {
        access_token,
        refresh_token: body
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(String::from)
            .or(previous_refresh),
        expires_at: now() + expires_in,
    })
}

async fn post_token(server: &AuthServer, pairs: &[(&str, &str)]) -> Result<Value, (u16, Value)> {
    let response = http()
        .post(&server.token_endpoint)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .body(form(pairs))
        .send()
        .await
        .map_err(|e| (0, json!({ "error": e.to_string() })))?;
    let status = response.status().as_u16();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if (200..300).contains(&status) {
        Ok(body)
    } else {
        Err((status, body))
    }
}

/// One refresh at a time across the app.
static REFRESH_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

async fn access_token(force_refresh: bool) -> Result<String, String> {
    let _guard = REFRESH_LOCK.lock().await;
    let tokens = load_json::<Tokens>(TOKENS_KEY).ok_or("Sign in to Notion first.")?;
    if !force_refresh && tokens.expires_at > now() + 120 {
        return Ok(tokens.access_token);
    }
    let refresh = tokens
        .refresh_token
        .clone()
        .ok_or("Your Notion sign-in expired. Sign in again.")?;
    let reg = load_json::<ClientReg>(CLIENT_KEY).ok_or("Sign in to Notion again.")?;
    let server = discover().await?;
    let mut pairs = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("client_id", reg.client_id.as_str()),
        ("resource", MCP_URL),
    ];
    if let Some(secret) = reg.client_secret.as_deref() {
        pairs.push(("client_secret", secret));
    }
    match post_token(&server, &pairs).await {
        Ok(body) => {
            let next = tokens_from(&body, Some(refresh))?;
            save_json(TOKENS_KEY, &next)?;
            Ok(next.access_token)
        }
        Err((_, body)) if body.get("error").and_then(Value::as_str) == Some("invalid_grant") => {
            let _ = store().delete(TOKENS_KEY);
            Err("Your Notion sign-in ended. Sign in again.".into())
        }
        Err((status, body)) => Err(format!(
            "Couldn't refresh the Notion sign-in ({status}): {}",
            body.get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
        )),
    }
}

// ─── MCP over Streamable HTTP ────────────────────────────────────────────────

static SESSION: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
static INITIALIZED: LazyLock<tokio::sync::Mutex<bool>> =
    LazyLock::new(|| tokio::sync::Mutex::new(false));
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// The JSON-RPC response with `id`, from a JSON or an event-stream body.
fn parse_response(content_type: &str, text: &str, id: u64) -> Option<Value> {
    if content_type.contains("text/event-stream") {
        let mut data = String::new();
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("data:") {
                data.push_str(rest.trim_start());
            } else if line.is_empty() && !data.is_empty() {
                if let Ok(value) = serde_json::from_str::<Value>(&data) {
                    if value.get("id").and_then(Value::as_u64) == Some(id) {
                        return Some(value);
                    }
                }
                data.clear();
            }
        }
        if !data.is_empty() {
            return serde_json::from_str::<Value>(&data).ok();
        }
        None
    } else {
        serde_json::from_str(text).ok()
    }
}

async fn send(body: Value, retry_auth: bool) -> Result<Option<Value>, String> {
    let id = body.get("id").and_then(Value::as_u64);
    let mut token = access_token(false).await?;
    for attempt in 0..2 {
        let mut request = http()
            .post(MCP_URL)
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL_VERSION)
            .body(body.to_string());
        if let Some(session) = SESSION.lock().ok().and_then(|s| s.clone()) {
            request = request.header("Mcp-Session-Id", session);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("Notion unreachable: {e}"))?;
        if response.status().as_u16() == 401 && retry_auth && attempt == 0 {
            token = access_token(true).await?;
            continue;
        }
        if let Some(session) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|h| h.to_str().ok())
        {
            if let Ok(mut slot) = SESSION.lock() {
                *slot = Some(session.to_string());
            }
        }
        let status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("")
            .to_string();
        let text = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!(
                "Notion {}: {}",
                status.as_u16(),
                text.chars().take(300).collect::<String>()
            ));
        }
        let Some(id) = id else { return Ok(None) };
        let reply = parse_response(&content_type, &text, id)
            .ok_or("Notion sent an answer Buzz couldn't read.")?;
        if let Some(error) = reply.get("error") {
            return Err(format!(
                "Notion: {}",
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("request failed")
            ));
        }
        return Ok(reply.get("result").cloned());
    }
    Err("Notion didn't accept the sign-in. Sign in again.".into())
}

async fn ensure_initialized() -> Result<(), String> {
    let mut done = INITIALIZED.lock().await;
    if *done {
        return Ok(());
    }
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    send(
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "Buzz", "version": env!("CARGO_PKG_VERSION") },
            },
        }),
        true,
    )
    .await?;
    let _ = send(
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        true,
    )
    .await;
    *done = true;
    Ok(())
}

async fn rpc(method: &str, params: Value) -> Result<Value, String> {
    ensure_initialized().await?;
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let result = send(
        json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        true,
    )
    .await?;
    Ok(result.unwrap_or(Value::Null))
}

/// A tool call's result: structured content when the tool gives it, else its
/// text (parsed as JSON when it is JSON).
fn tool_value(result: &Value) -> Result<Value, String> {
    let text: String = result
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(format!(
            "Notion: {}",
            text.chars().take(500).collect::<String>()
        ));
    }
    if let Some(structured) = result.get("structuredContent") {
        if !structured.is_null() {
            return Ok(structured.clone());
        }
    }
    Ok(serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text)))
}

async fn call_tool(name: &str, arguments: Value) -> Result<Value, String> {
    let result = rpc(
        "tools/call",
        json!({ "name": name, "arguments": arguments }),
    )
    .await?;
    tool_value(&result)
}

fn identity(value: &Value) -> McpStatus {
    let pick = |paths: &[&[&str]]| {
        paths.iter().find_map(|path| {
            let mut v = value;
            for key in *path {
                v = v.get(*key)?;
            }
            v.as_str().map(String::from)
        })
    };
    McpStatus {
        connected: true,
        workspace: pick(&[
            &["workspace", "name"],
            &["workspace_name"],
            &["bot", "workspace_name"],
        ]),
        user: pick(&[&["user", "name"], &["user", "email"], &["name"]]),
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

static PROFILE: LazyLock<Mutex<Option<McpStatus>>> = LazyLock::new(|| Mutex::new(None));
static PENDING: LazyLock<Mutex<Option<oneshot::Sender<()>>>> = LazyLock::new(|| Mutex::new(None));

/// Whether Buzz is signed in to Notion, and as whom.
#[tauri::command]
pub async fn notion_mcp_status() -> Result<McpStatus, String> {
    if load_json::<Tokens>(TOKENS_KEY).is_none() {
        return Ok(McpStatus::default());
    }
    if let Some(profile) = PROFILE.lock().ok().and_then(|p| p.clone()) {
        return Ok(profile);
    }
    let status = match call_tool("notion-get-self", json!({})).await {
        Ok(value) => identity(&value),
        Err(_) => McpStatus {
            connected: load_json::<Tokens>(TOKENS_KEY).is_some(),
            ..McpStatus::default()
        },
    };
    if status.connected {
        if let Ok(mut slot) = PROFILE.lock() {
            *slot = Some(status.clone());
        }
    }
    Ok(status)
}

#[derive(Clone)]
struct CallbackState {
    state: String,
    sender: std::sync::Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>,
}

async fn callback(
    Query(query): Query<HashMap<String, String>>,
    AxumState(cb): AxumState<CallbackState>,
) -> Response {
    let result = if query.get("state") != Some(&cb.state) {
        Err("The sign-in answer didn't match this request.".to_string())
    } else if let Some(code) = query.get("code").filter(|c| !c.is_empty()) {
        Ok(code.clone())
    } else {
        Err(query
            .get("error_description")
            .or_else(|| query.get("error"))
            .cloned()
            .unwrap_or_else(|| "Notion didn't send a sign-in code.".into()))
    };
    if let Some(sender) = cb.sender.lock().ok().and_then(|mut s| s.take()) {
        let _ = sender.send(result);
    }
    Html(SIGNED_IN_HTML).into_response()
}

/// Sign in: Notion's page opens in the browser; the owner picks the workspace
/// and approves; Buzz keeps the tokens in the keyring.
#[tauri::command]
pub async fn notion_mcp_sign_in(app: AppHandle) -> Result<McpStatus, String> {
    let server = discover().await?;
    let reg = client_registration(&server).await?;

    let verifier = b64url(&random_32());
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let state = uuid::Uuid::new_v4().simple().to_string();

    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .await
        .map_err(|e| format!("Couldn't start the sign-in callback on port {REDIRECT_PORT}: {e}"))?;
    let (sender, receiver) = oneshot::channel();
    let router = Router::new()
        .route(REDIRECT_PATH, get(callback))
        .with_state(CallbackState {
            state: state.clone(),
            sender: std::sync::Arc::new(Mutex::new(Some(sender))),
        });
    let serve = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let mut authorize = Url::parse(&server.authorization_endpoint)
        .map_err(|e| format!("Notion's sign-in address is invalid: {e}"))?;
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &reg.client_id)
        .append_pair("redirect_uri", &reg.redirect_uri)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("resource", MCP_URL)
        .append_pair("prompt", "consent");
    if let Err(e) = app.opener().open_url(authorize.as_str(), None::<&str>) {
        serve.abort();
        return Err(format!("Couldn't open the browser: {e}"));
    }

    let (cancel_sender, cancel_receiver) = oneshot::channel();
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(previous) = pending.replace(cancel_sender) {
            let _ = previous.send(());
        }
    }
    let code = tokio::select! {
        result = tokio::time::timeout(SIGN_IN_TIMEOUT, receiver) => match result {
            Ok(Ok(Ok(code))) => code,
            Ok(Ok(Err(error))) => { serve.abort(); return Err(error); }
            Ok(Err(_)) => { serve.abort(); return Err("The sign-in stopped.".into()); }
            Err(_) => { serve.abort(); return Err("Sign-in timed out. Try again.".into()); }
        },
        _ = cancel_receiver => { serve.abort(); return Err("Sign-in cancelled.".into()); }
    };
    serve.abort();

    let mut pairs = vec![
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", reg.redirect_uri.as_str()),
        ("client_id", reg.client_id.as_str()),
        ("code_verifier", verifier.as_str()),
        ("resource", MCP_URL),
    ];
    if let Some(secret) = reg.client_secret.as_deref() {
        pairs.push(("client_secret", secret));
    }
    let body = post_token(&server, &pairs)
        .await
        .map_err(|(status, body)| {
            format!(
                "Notion didn't finish the sign-in ({status}): {}",
                body.get("error_description")
                    .or_else(|| body.get("error"))
                    .and_then(Value::as_str)
                    .unwrap_or("unknown error")
            )
        })?;
    save_json(TOKENS_KEY, &tokens_from(&body, None)?)?;
    *INITIALIZED.lock().await = false;
    if let Ok(mut slot) = SESSION.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = PROFILE.lock() {
        *slot = None;
    }
    notion_mcp_status().await
}

#[tauri::command]
pub fn notion_mcp_cancel_sign_in() {
    if let Some(pending) = PENDING.lock().ok().and_then(|mut p| p.take()) {
        let _ = pending.send(());
    }
}

/// Forget the sign-in (the app registration is kept for next time).
#[tauri::command]
pub async fn notion_mcp_sign_out() -> Result<(), String> {
    store().delete(TOKENS_KEY)?;
    *INITIALIZED.lock().await = false;
    if let Ok(mut slot) = SESSION.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = PROFILE.lock() {
        *slot = None;
    }
    Ok(())
}

/// The tools Notion offers this account, with their input schemas.
#[tauri::command]
pub async fn notion_mcp_tools() -> Result<Value, String> {
    rpc("tools/list", json!({})).await
}

/// Call one of the Tasks page's Notion tools.
#[tauri::command]
pub async fn notion_mcp_call(name: String, arguments: Value) -> Result<Value, String> {
    if !ALLOWED_TOOLS.contains(&name.as_str()) {
        return Err(format!("{name} isn't available to the Tasks page"));
    }
    call_tool(&name, arguments).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_event_stream_responses() {
        let text =
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"ok\":true}}\n\n";
        let value = parse_response("text/event-stream", text, 7).unwrap();
        assert_eq!(value["result"]["ok"], true);
    }

    #[test]
    fn tool_results_prefer_structured_content() {
        let result = json!({ "content": [{ "type": "text", "text": "{\"a\":1}" }] });
        assert_eq!(tool_value(&result).unwrap()["a"], 1);
        let errored = json!({ "isError": true, "content": [{ "type": "text", "text": "nope" }] });
        assert!(tool_value(&errored).is_err());
    }

    #[test]
    fn pkce_challenge_is_base64url_sha256() {
        let challenge = b64url(&Sha256::digest(
            b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        ));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
