//! The Office: Munder Difflin's agent floor, hosted inside Buzz.
//!
//! Munder Difflin's main process runs unmodified as a sidecar
//! (`src/sidecar/launcher.cjs` in the office runtime), exposing its IPC surface
//! over a loopback WebSocket guarded by a per-launch token. The Office route
//! loads the office UI in an iframe and connects it to that socket.
//!
//! The sidecar starts lazily, the first time the Office is opened, and stops
//! with Buzz. It is told to exit by closing its stdin (Windows has no graceful
//! SIGTERM for child processes); a hard kill is the fallback.
//!
//! Each community (server) has its own Office: its own data folder (floor,
//! hive, Michael's key) and its own agent records (see `OfficeScope`). Each
//! one starts the first time its community opens it and keeps running when
//! you switch away, so switching back is instant and its agents keep working;
//! all of them stop with Buzz.
//!
//! Its Buzz bridge reports the floor's agents on stdout (`MD_OFFICE_ROSTER`);
//! Buzz gives each one an owner-attested identity and sends the identities
//! back as a JSON line on the sidecar's stdin, so keys never touch disk.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

const READY_PREFIX: &str = "MD_SIDECAR_READY ";
const ROSTER_PREFIX: &str = "MD_OFFICE_ROSTER ";
const READY_TIMEOUT: Duration = Duration::from_secs(45);
const STOP_GRACE: Duration = Duration::from_secs(6);
const MASTER_KEY_NAME: &str = "office.master-key";

#[derive(Clone, Serialize)]
pub struct OfficeConnection {
    url: String,
    token: String,
}

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
    conn: OfficeConnection,
    scope: OfficeScope,
}

/// The community an Office belongs to, by its relay (as the workspace names
/// it). `legacy` marks the community that owns the Office data from before
/// Offices were per community (`<app data>/office`), whose agent records carry
/// no community tag yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OfficeScope {
    pub community: String,
    pub legacy: bool,
}

const COMMUNITIES_FILE: &str = "office-communities.json";
const LEGACY_DIR: &str = "office";

pub(crate) fn normalize_community(relay: &str) -> String {
    relay.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn current_community(app: &AppHandle) -> String {
    let state = app.state::<crate::app_state::AppState>();
    normalize_community(&crate::relay::relay_ws_url_with_override(&state))
}

/// Which data folder each community's Office uses (`community -> folder`
/// under the app data dir). The first community gets the existing `office`
/// folder, so the Office from before keeps its floor and Michael.
fn office_folders(base: &Path) -> std::collections::BTreeMap<String, String> {
    std::fs::read(base.join(COMMUNITIES_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn folder_for(folders: &std::collections::BTreeMap<String, String>, community: &str) -> String {
    if let Some(folder) = folders.get(community) {
        return folder.clone();
    }
    if folders.values().any(|f| f == LEGACY_DIR) {
        use sha2::Digest;
        let hash = hex::encode(sha2::Sha256::digest(community.as_bytes()));
        format!("office-{}", &hash[..12])
    } else {
        LEGACY_DIR.to_string()
    }
}

/// The active community's Office scope and data folder (recorded on first
/// use, so it stays the same).
fn office_scope(app: &AppHandle) -> Result<(OfficeScope, PathBuf), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    let community = current_community(app);
    let mut folders = office_folders(&base);
    let folder = folder_for(&folders, &community);
    if folders.get(&community) != Some(&folder) {
        folders.insert(community.clone(), folder.clone());
        std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        let json = serde_json::to_vec_pretty(&folders).map_err(|e| e.to_string())?;
        std::fs::write(base.join(COMMUNITIES_FILE), json)
            .map_err(|e| format!("save office folders: {e}"))?;
    }
    let legacy = folder == LEGACY_DIR;
    let user_data = base.join(&folder);
    if !legacy {
        if let Err(error) = seed_office_settings(&base, &user_data) {
            eprintln!("buzz-desktop: new office settings: {error}");
        }
    }
    Ok((OfficeScope { community, legacy }, user_data))
}

/// A community's Office the first time it starts: its data folder has no
/// settings, or the Office's first-run defaults. It takes the original
/// Office's settings (providers, models, preferences) so it opens straight
/// onto its floor, with its own hive (`<folder>/hive`) and none of the
/// original's server-specific state (missions, webhooks, seeded routines).
fn seed_office_settings(base: &Path, user_data: &Path) -> Result<(), String> {
    let target = user_data.join("config.json");
    let current: serde_json::Value = std::fs::read(&target)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if current.get("onboardingComplete").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(());
    }
    let Some(original) = std::fs::read(base.join(LEGACY_DIR).join("config.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
    else {
        return Ok(()); // no Office set up yet: the first-run setup runs as usual
    };
    let (Some(original), Some(current)) = (original.as_object(), current.as_object()) else {
        return Ok(());
    };
    let mut merged = current.clone();
    for (key, value) in original {
        merged.insert(key.clone(), value.clone());
    }
    let hive = user_data.join("hive");
    std::fs::create_dir_all(&hive).map_err(|e| format!("make {}: {e}", hive.display()))?;
    let hive = serde_json::Value::String(hive.to_string_lossy().into_owned());
    merged.insert("harnessHome".into(), hive.clone());
    merged.insert("recentHives".into(), serde_json::Value::Array(vec![hive]));
    merged.insert("missions".into(), serde_json::json!([]));
    merged.insert("webhookTriggers".into(), serde_json::json!([]));
    merged.insert("opsStandupSeeded".into(), serde_json::Value::Bool(false));
    merged.insert("heartbeatSeeded".into(), serde_json::Value::Bool(false));
    merged.insert("onboardingComplete".into(), serde_json::Value::Bool(true));
    std::fs::create_dir_all(user_data).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(&serde_json::Value::Object(merged))
        .map_err(|e| e.to_string())?;
    let staging = user_data.join("config.json.seed");
    std::fs::write(&staging, json).map_err(|e| format!("write office settings: {e}"))?;
    std::fs::rename(&staging, &target).map_err(|e| format!("save office settings: {e}"))
}

/// The active community's Office data folder, without recording anything.
pub(crate) fn active_office_dir(app: &AppHandle) -> Option<PathBuf> {
    let base = app.path().app_data_dir().ok()?;
    let folders = office_folders(&base);
    Some(base.join(folder_for(&folders, &current_community(app))))
}

/// The active community's scope without recording anything (for filtering
/// which agent records show).
pub(crate) fn active_office_scope(app: &AppHandle) -> Option<OfficeScope> {
    let base = app.path().app_data_dir().ok()?;
    let community = current_community(app);
    let folders = office_folders(&base);
    let legacy = folder_for(&folders, &community) == LEGACY_DIR;
    Some(OfficeScope { community, legacy })
}

#[derive(Default)]
pub struct OfficeState {
    /// One per community that has opened its Office.
    running: Mutex<Vec<Running>>,
    /// Held across check-and-spawn so concurrent `office_connect` calls (React
    /// runs effects twice in development) share one sidecar instead of each
    /// starting their own: two sidecars racing on first start would each mint
    /// a Michael identity.
    start_lock: tokio::sync::Mutex<()>,
    /// Serializes roster syncs, so two quick reports can't both create a
    /// record for the same new agent.
    roster_lock: tokio::sync::Mutex<()>,
}

/// Where the office runtime lives: `BUZZ_OFFICE_DIR` in development (a
/// munder-difflin checkout), `<resources>/office` in packaged builds.
fn office_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("BUZZ_OFFICE_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let resources = app
        .path()
        .resource_dir()
        .map_err(|e| format!("no resource dir: {e}"))?;
    Ok(resources.join("office"))
}

/// The JS runtime that runs the sidecar. Electron in Node mode, so the
/// Electron-ABI native modules (node-pty, better-sqlite3) load as built.
fn office_runtime(dir: &Path) -> PathBuf {
    if let Some(bin) = std::env::var_os("BUZZ_OFFICE_RUNTIME") {
        return PathBuf::from(bin);
    }
    let dist = dir.join("node_modules").join("electron").join("dist");
    if cfg!(target_os = "windows") {
        dist.join("electron.exe")
    } else if cfg!(target_os = "macos") {
        dist.join("Electron.app/Contents/MacOS/Electron")
    } else {
        dist.join("electron")
    }
}

/// 32-byte key the sidecar uses for its secret store, kept in the OS keyring
/// alongside Buzz's own secrets. Created on first use.
fn master_key() -> Result<String, String> {
    let store = crate::secret_store::SecretStore::shared(crate::app_state::keyring_service());
    if let Some(existing) = store.load(MASTER_KEY_NAME)? {
        return Ok(existing);
    }
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("random key: {e}"))?;
    let key = base64::engine::general_purpose::STANDARD.encode(bytes);
    store.store(MASTER_KEY_NAME, &key)?;
    Ok(key)
}

/// The key the office minted for Michael before Buzz held it, if any:
/// `<office data>/buzz-michael.key`, encrypted by the sidecar's safeStorage
/// (`"MDS1" ‖ iv[12] ‖ tag[16] ‖ ciphertext`, AES-256-GCM under the master key).
/// Adopted once so Michael keeps his pubkey when Buzz takes over his identity.
fn office_minted_key(user_data: &Path) -> Option<String> {
    use aes_gcm::aead::{Aead, KeyInit};
    let blob = std::fs::read(user_data.join("buzz-michael.key")).ok()?;
    if blob.len() < 32 || &blob[..4] != b"MDS1" {
        return None;
    }
    let key = base64::engine::general_purpose::STANDARD
        .decode(master_key().ok()?)
        .ok()?;
    let cipher = aes_gcm::Aes256Gcm::new_from_slice(&key).ok()?;
    // aes-gcm expects ciphertext ‖ tag.
    let mut sealed = blob[32..].to_vec();
    sealed.extend_from_slice(&blob[16..32]);
    let plain = cipher
        .decrypt(aes_gcm::Nonce::from_slice(&blob[4..16]), sealed.as_ref())
        .ok()?;
    String::from_utf8(plain).ok()
}

/// The active workspace relay (HTTP API base) and the signed-in identity, which
/// becomes the office owner: the only Buzz user who can task Michael.
fn bridge_target(app: &AppHandle) -> Result<(String, String), String> {
    let state = app.state::<crate::app_state::AppState>();
    let owner = state
        .keys
        .lock()
        .map_err(|_| "identity state poisoned")?
        .public_key()
        .to_hex();
    Ok((
        crate::relay::relay_api_base_url_with_override(&state),
        owner,
    ))
}

/// Buzz's own CLI, bundled next to the desktop binary (`externalBin`).
fn buzz_cli() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("BUZZ_OFFICE_CLI") {
        return Some(PathBuf::from(path));
    }
    let name = if cfg!(target_os = "windows") {
        "buzz.exe"
    } else {
        "buzz"
    };
    let path = std::env::current_exe().ok()?.parent()?.join(name);
    path.is_file().then_some(path)
}

fn spawn_sidecar(
    app: &AppHandle,
    scope: &OfficeScope,
    user_data: &Path,
    agent: Option<&crate::commands::OfficeAgentIdentity>,
) -> Result<Running, String> {
    let dir = office_dir(app)?;
    let launcher = dir.join("src").join("sidecar").join("launcher.cjs");
    if !launcher.is_file() {
        return Err(format!("office runtime not found at {}", dir.display()));
    }
    let runtime = office_runtime(&dir);
    if !runtime.is_file() {
        return Err(format!(
            "office JS runtime not found at {}",
            runtime.display()
        ));
    }
    std::fs::create_dir_all(user_data)
        .map_err(|e| format!("create {}: {e}", user_data.display()))?;

    let mut cmd = Command::new(&runtime);
    cmd.arg(&launcher)
        .current_dir(&dir)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .env("MD_SIDECAR_STDIN_WATCH", "1")
        .env("MD_USER_DATA", user_data)
        .env("MD_APP_PATH", &dir)
        .env("MD_MASTER_KEY", master_key()?);
    // The AI accounts picked in Settings: agents start on them.
    if let Some(accounts) = crate::ai_accounts::active_file(app) {
        cmd.env("BUZZ_AI_ACCOUNTS_FILE", accounts);
    }
    // Buzz bridge: Michael joins this workspace and takes requests from its owner.
    let (relay_url, owner) = bridge_target(app)?;
    if let Some(cli) = buzz_cli() {
        cmd.env("BUZZ_OFFICE_RELAY_URL", relay_url)
            .env("BUZZ_OFFICE_OWNER", owner)
            .env("BUZZ_OFFICE_CLI", cli);
        // Michael's Buzz-held identity. The launcher moves both into memory and
        // out of the environment before any agent terminal can inherit them.
        if let Some(agent) = agent {
            cmd.env("BUZZ_OFFICE_AGENT_KEY", &agent.secret_hex)
                .env("BUZZ_OFFICE_AGENT_AUTH", &agent.auth_tag);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("start office sidecar ({}): {e}", runtime.display()))?;
    // The Office and its agents' terminals end with the app, even on a crash.
    crate::app_job::tie_to_app(child.id());
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("sidecar stderr unavailable")?;

    forward_log(stderr, "stderr");
    let (tx, rx) = mpsc::channel::<OfficeConnection>();
    let roster_app = app.clone();
    let roster_scope = scope.clone();
    std::thread::spawn(move || {
        let mut tx = Some(tx);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(json) = line.strip_prefix(ROSTER_PREFIX) {
                match parse_roster(json) {
                    Some(roster) => {
                        eprintln!("buzz-office: floor reports {} agent(s)", roster.len());
                        tauri::async_runtime::spawn(sync_office_workers(
                            roster_app.clone(),
                            roster_scope.clone(),
                            roster,
                        ));
                    }
                    None => eprintln!("buzz-office: unreadable roster report"),
                }
                continue;
            }
            if let Some(json) = line.strip_prefix(crate::office_desk::ACTION_PREFIX) {
                crate::office_desk::handle_action(&roster_app, &roster_scope, json);
                continue;
            }
            if let Some(json) = line.strip_prefix(READY_PREFIX) {
                if let (Some(sender), Ok(ready)) =
                    (tx.take(), serde_json::from_str::<serde_json::Value>(json))
                {
                    let port = ready["port"].as_u64().unwrap_or(0);
                    let token = ready["token"].as_str().unwrap_or_default().to_string();
                    let _ = sender.send(OfficeConnection {
                        url: format!("ws://127.0.0.1:{port}/"),
                        token,
                    });
                }
                continue; // never log the token
            }
            eprintln!("buzz-office: {line}");
        }
    });

    match rx.recv_timeout(READY_TIMEOUT) {
        Ok(conn) if !conn.token.is_empty() => Ok(Running {
            child,
            stdin,
            conn,
            scope: scope.clone(),
        }),
        outcome => {
            let _ = child.kill();
            let _ = child.wait();
            Err(match outcome {
                Ok(_) => "office sidecar sent an invalid ready line".into(),
                Err(_) => "office sidecar did not become ready".into(),
            })
        }
    }
}

/// `{"agents":[{"id":"jim-1","name":"Jim"}]}` → [(id, name)].
fn parse_roster(json: &str) -> Option<Vec<(String, String)>> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let agents = value.get("agents")?.as_array()?;
    Some(
        agents
            .iter()
            .filter_map(|a| {
                let id = a.get("id")?.as_str()?.trim();
                let name = a.get("name")?.as_str()?.trim();
                (!id.is_empty() && !name.is_empty()).then(|| (id.to_string(), name.to_string()))
            })
            .collect(),
    )
}

/// Give the floor's agents their Buzz identities and hand them to the bridge.
async fn sync_office_workers(app: AppHandle, scope: OfficeScope, roster: Vec<(String, String)>) {
    let Some(state) = app.try_state::<OfficeState>() else {
        return;
    };
    let _syncing = state.roster_lock.lock().await;
    let identities = match crate::commands::ensure_office_workers(&app, &scope, &roster).await {
        Ok(identities) => identities,
        Err(error) => {
            eprintln!("buzz-desktop: office agent identities unavailable: {error}");
            return;
        }
    };
    let Ok(mut line) = serde_json::to_string(
        &serde_json::json!({ "type": "office-agents", "agents": identities }),
    ) else {
        return;
    };
    line.push('\n');
    // The report can arrive before office_connect has stored the sidecar.
    for _ in 0..50 {
        if send_to_sidecar(&app, &scope, &line) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    eprintln!("buzz-desktop: office sidecar did not take its agents' identities");
}

const CALL_MODELS_FILE: &str = "call-models.json";

/// The model each Office agent answers with in calls (by agent pubkey), as
/// picked in the call's agent menu; agents not listed use the default
/// (Sonnet 5.5). Kept in the active community's Office folder, where its
/// bridge reads it on each answer.
#[tauri::command]
pub async fn get_call_models(
    app: AppHandle,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let (_, user_data) = office_scope(&app)?;
    Ok(std::fs::read(user_data.join(CALL_MODELS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default())
}

/// Pick the model `agent_pubkey` answers with in calls; empty clears it.
#[tauri::command]
pub async fn set_call_model(
    app: AppHandle,
    agent_pubkey: String,
    model: String,
) -> Result<(), String> {
    let pubkey = agent_pubkey.trim().to_ascii_lowercase();
    if pubkey.len() != 64 || !pubkey.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("not an agent pubkey".into());
    }
    let model = model.trim().to_string();
    if !model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '[' | ']'))
    {
        return Err("not a model id".into());
    }
    let (_, user_data) = office_scope(&app)?;
    std::fs::create_dir_all(&user_data).map_err(|e| e.to_string())?;
    let path = user_data.join(CALL_MODELS_FILE);
    let mut models: std::collections::BTreeMap<String, String> = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if model.is_empty() {
        models.remove(&pubkey);
    } else {
        models.insert(pubkey, model);
    }
    let json = serde_json::to_vec_pretty(&models).map_err(|e| e.to_string())?;
    let staging = path.with_extension("json.tmp");
    std::fs::write(&staging, json).map_err(|e| format!("save call models: {e}"))?;
    std::fs::rename(&staging, &path).map_err(|e| format!("save call models: {e}"))
}

/// Set at startup, for nudging the Offices from places without an AppHandle.
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

pub(crate) fn remember_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// A message just went out (the owner typed one, or a call transcript was
/// posted): tell every running Office to check its feeds now, instead of at
/// its next poll, so agents start on it straight away.
pub(crate) fn poll_now() {
    send_line("{\"type\":\"poll-now\"}");
}

/// Write one JSON line to every running Office's stdin.
pub(crate) fn send_line(line: &str) {
    let Some(app) = APP.get() else {
        return;
    };
    let Some(state) = app.try_state::<OfficeState>() else {
        return;
    };
    let Ok(mut guard) = state.running.lock() else {
        return;
    };
    use std::io::Write;
    for running in guard.iter_mut() {
        if let Some(stdin) = running.stdin.as_mut() {
            let _ = stdin
                .write_all(line.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush());
        }
    }
}

static POKE_PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The app's live relay connection delivered an event: the Offices check
/// their feeds in a moment. Bursts (a channel's history loading) collapse
/// into one check; this is what replaces fast polling in the Office.
pub(crate) fn relay_event_seen() {
    use std::sync::atomic::Ordering;
    if POKE_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(150));
        POKE_PENDING.store(false, Ordering::Release);
        poll_now();
    });
}

/// Write one line to the running sidecar's stdin. False if it isn't running
/// (or is another community's: a late report never reaches the next Office).
pub(crate) fn send_to_sidecar(app: &AppHandle, scope: &OfficeScope, line: &str) -> bool {
    use std::io::Write;
    let Some(state) = app.try_state::<OfficeState>() else {
        return false;
    };
    let Ok(mut guard) = state.running.lock() else {
        return false;
    };
    let Some(stdin) = guard
        .iter_mut()
        .find(|r| &r.scope == scope)
        .and_then(|r| r.stdin.as_mut())
    else {
        return false;
    };
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.flush())
        .is_ok()
}

fn forward_log(stream: impl Read + Send + 'static, label: &'static str) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            eprintln!("buzz-office[{label}]: {line}");
        }
    });
}

fn stop_running(mut running: Running) {
    drop(running.stdin.take()); // EOF on stdin = clean shutdown request
    let deadline = Instant::now() + STOP_GRACE;
    while Instant::now() < deadline {
        match running.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    let _ = running.child.kill();
    let _ = running.child.wait();
}

/// Start the office sidecar if needed and return how to reach it.
#[tauri::command]
pub async fn office_connect(
    app: AppHandle,
    state: State<'_, OfficeState>,
) -> Result<OfficeConnection, String> {
    let _starting = state.start_lock.lock().await;
    let (scope, user_data) = office_scope(&app)?;
    {
        let mut guard = state.running.lock().map_err(|_| "office state poisoned")?;
        // Forget Offices that exited; this community's, if running, is ready.
        guard.retain_mut(|running| matches!(running.child.try_wait(), Ok(None)));
        if let Some(running) = guard.iter().find(|running| running.scope == scope) {
            return Ok(running.conn.clone());
        }
    }
    // Michael as the owner's Buzz agent. Best-effort: without it the bridge
    // falls back to the identity the office keeps itself.
    let import = office_minted_key(&user_data);
    let agent = match crate::commands::ensure_office_agent(&app, &scope, import).await {
        Ok(agent) => Some(agent),
        Err(error) => {
            eprintln!("buzz-desktop: office agent identity unavailable: {error}");
            None
        }
    };
    let handle = app.clone();
    let spawn_scope = scope.clone();
    let running = tauri::async_runtime::spawn_blocking(move || {
        spawn_sidecar(&handle, &spawn_scope, &user_data, agent.as_ref())
    })
    .await
    .map_err(|e| format!("office start task failed: {e}"))??;
    let conn = running.conn.clone();
    state
        .running
        .lock()
        .map_err(|_| "office state poisoned")?
        .push(running);
    crate::commands::set_office_agent_deployed(&app, Some(&scope), true);
    Ok(conn)
}

/// The running office's connection, or `None` if it isn't running. Never
/// starts it, so views like the Agents page can show the roster without
/// launching the office as a side effect.
#[tauri::command]
pub async fn office_status(
    app: AppHandle,
    state: State<'_, OfficeState>,
) -> Result<Option<OfficeConnection>, String> {
    let community = current_community(&app);
    let mut guard = state.running.lock().map_err(|_| "office state poisoned")?;
    let Some(running) = guard.iter_mut().find(|r| r.scope.community == community) else {
        return Ok(None);
    };
    let alive = matches!(running.child.try_wait(), Ok(None));
    Ok(alive.then(|| running.conn.clone()))
}

/// Stop the active community's Office (its agents' terminals stop with it).
#[tauri::command]
pub async fn office_stop(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || shutdown_current(&app))
        .await
        .map_err(|e| format!("office stop task failed: {e}"))
}

/// Stop the active community's Office (stopping its Michael); the others
/// keep running.
pub(crate) fn shutdown_current(app: &AppHandle) {
    let community = current_community(app);
    let Some(state) = app.try_state::<OfficeState>() else {
        return;
    };
    let taken = state.running.lock().ok().and_then(|mut guard| {
        let at = guard.iter().position(|r| r.scope.community == community)?;
        Some(guard.remove(at))
    });
    if let Some(running) = taken {
        let scope = running.scope.clone();
        stop_running(running);
        crate::commands::set_office_agent_deployed(app, Some(&scope), false);
    }
}

/// Stop every running Office. Also Buzz's shutdown path.
pub(crate) fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<OfficeState>() {
        let all = state
            .running
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default();
        // Asked to stop together, so the grace periods overlap.
        let stopping: Vec<_> = all
            .into_iter()
            .map(|running| {
                let scope = running.scope.clone();
                (scope, std::thread::spawn(move || stop_running(running)))
            })
            .collect();
        for (scope, done) in stopping {
            let _ = done.join();
            crate::commands::set_office_agent_deployed(app, Some(&scope), false);
        }
    }
}

#[cfg(test)]
mod scope_tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn the_first_community_keeps_the_original_office_folder() {
        let folders = BTreeMap::new();
        assert_eq!(folder_for(&folders, "wss://a.example"), LEGACY_DIR);
    }

    #[test]
    fn later_communities_get_their_own_folders_and_keep_them() {
        let mut folders = BTreeMap::new();
        folders.insert("wss://a.example".to_string(), LEGACY_DIR.to_string());
        let b = folder_for(&folders, "wss://b.example");
        assert!(b.starts_with("office-") && b != LEGACY_DIR);
        assert_ne!(b, folder_for(&folders, "wss://c.example"));
        folders.insert("wss://b.example".to_string(), b.clone());
        assert_eq!(folder_for(&folders, "wss://b.example"), b);
        assert_eq!(folder_for(&folders, "wss://a.example"), LEGACY_DIR);
    }

    #[test]
    fn communities_compare_without_case_or_trailing_slash() {
        assert_eq!(
            normalize_community(" WSS://Relay.Example/ "),
            normalize_community("wss://relay.example")
        );
    }
}

#[cfg(test)]
mod seed_tests {
    use super::*;

    #[test]
    fn a_new_office_takes_the_original_settings_with_its_own_hive() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        std::fs::create_dir_all(base.join(LEGACY_DIR)).unwrap();
        std::fs::write(
            base.join(LEGACY_DIR).join("config.json"),
            r#"{"onboardingComplete":true,"harnessHome":"C:/old/hive","godModel":"opus","missions":[{"id":1}],"heartbeatSeeded":true}"#,
        )
        .unwrap();
        let user_data = base.join("office-abc");
        std::fs::create_dir_all(&user_data).unwrap();
        std::fs::write(user_data.join("config.json"), r#"{"onboardingComplete":false,"autoMode":false}"#).unwrap();

        seed_office_settings(base, &user_data).unwrap();
        let seeded: serde_json::Value =
            serde_json::from_slice(&std::fs::read(user_data.join("config.json")).unwrap()).unwrap();
        assert_eq!(seeded["onboardingComplete"], true);
        assert_eq!(seeded["godModel"], "opus");
        assert_eq!(seeded["autoMode"], false);
        assert_eq!(seeded["missions"], serde_json::json!([]));
        assert_eq!(seeded["heartbeatSeeded"], false);
        let hive = seeded["harnessHome"].as_str().unwrap();
        assert!(hive.ends_with("hive") && !hive.contains("old"));
        assert!(user_data.join("hive").is_dir());
    }

    #[test]
    fn a_set_up_office_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        std::fs::create_dir_all(base.join(LEGACY_DIR)).unwrap();
        std::fs::write(base.join(LEGACY_DIR).join("config.json"), r#"{"godModel":"opus"}"#).unwrap();
        let user_data = base.join("office-abc");
        std::fs::create_dir_all(&user_data).unwrap();
        let mine = r#"{"onboardingComplete":true,"godModel":"sonnet"}"#;
        std::fs::write(user_data.join("config.json"), mine).unwrap();
        seed_office_settings(base, &user_data).unwrap();
        assert_eq!(std::fs::read_to_string(user_data.join("config.json")).unwrap(), mine);
    }
}
