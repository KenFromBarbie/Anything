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
}

#[derive(Default)]
pub struct OfficeState {
    running: Mutex<Option<Running>>,
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

fn office_user_data(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("office"))
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
    let user_data = office_user_data(app)?;
    std::fs::create_dir_all(&user_data)
        .map_err(|e| format!("create {}: {e}", user_data.display()))?;

    let mut cmd = Command::new(&runtime);
    cmd.arg(&launcher)
        .current_dir(&dir)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .env("MD_SIDECAR_STDIN_WATCH", "1")
        .env("MD_USER_DATA", &user_data)
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
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("sidecar stderr unavailable")?;

    forward_log(stderr, "stderr");
    let (tx, rx) = mpsc::channel::<OfficeConnection>();
    let roster_app = app.clone();
    std::thread::spawn(move || {
        let mut tx = Some(tx);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(json) = line.strip_prefix(ROSTER_PREFIX) {
                match parse_roster(json) {
                    Some(roster) => {
                        eprintln!("buzz-office: floor reports {} agent(s)", roster.len());
                        tauri::async_runtime::spawn(sync_office_workers(
                            roster_app.clone(),
                            roster,
                        ));
                    }
                    None => eprintln!("buzz-office: unreadable roster report"),
                }
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
        Ok(conn) if !conn.token.is_empty() => Ok(Running { child, stdin, conn }),
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
async fn sync_office_workers(app: AppHandle, roster: Vec<(String, String)>) {
    let Some(state) = app.try_state::<OfficeState>() else {
        return;
    };
    let _syncing = state.roster_lock.lock().await;
    let identities = match crate::commands::ensure_office_workers(&app, &roster).await {
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
        if send_to_sidecar(&app, &line) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    eprintln!("buzz-desktop: office sidecar did not take its agents' identities");
}

/// Write one line to the running sidecar's stdin. False if it isn't running.
fn send_to_sidecar(app: &AppHandle, line: &str) -> bool {
    use std::io::Write;
    let Some(state) = app.try_state::<OfficeState>() else {
        return false;
    };
    let Ok(mut guard) = state.running.lock() else {
        return false;
    };
    let Some(stdin) = guard.as_mut().and_then(|r| r.stdin.as_mut()) else {
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
    {
        let mut guard = state.running.lock().map_err(|_| "office state poisoned")?;
        if let Some(running) = guard.as_mut() {
            if matches!(running.child.try_wait(), Ok(None)) {
                return Ok(running.conn.clone());
            }
            *guard = None; // exited; start a fresh one below
        }
    }
    // Michael as the owner's Buzz agent. Best-effort: without it the bridge
    // falls back to the identity the office keeps itself.
    let import = office_user_data(&app)
        .ok()
        .and_then(|dir| office_minted_key(&dir));
    let agent = match crate::commands::ensure_office_agent(&app, import).await {
        Ok(agent) => Some(agent),
        Err(error) => {
            eprintln!("buzz-desktop: office agent identity unavailable: {error}");
            None
        }
    };
    let handle = app.clone();
    let running =
        tauri::async_runtime::spawn_blocking(move || spawn_sidecar(&handle, agent.as_ref()))
            .await
            .map_err(|e| format!("office start task failed: {e}"))??;
    let conn = running.conn.clone();
    *state.running.lock().map_err(|_| "office state poisoned")? = Some(running);
    crate::commands::set_office_agent_deployed(&app, true);
    Ok(conn)
}

/// The running office's connection, or `None` if it isn't running. Never
/// starts it, so views like the Agents page can show the roster without
/// launching the office as a side effect.
#[tauri::command]
pub async fn office_status(
    state: State<'_, OfficeState>,
) -> Result<Option<OfficeConnection>, String> {
    let mut guard = state.running.lock().map_err(|_| "office state poisoned")?;
    let Some(running) = guard.as_mut() else {
        return Ok(None);
    };
    let alive = matches!(running.child.try_wait(), Ok(None));
    Ok(alive.then(|| running.conn.clone()))
}

/// Stop the office sidecar (its agents' terminals stop with it).
#[tauri::command]
pub async fn office_stop(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || shutdown(&app))
        .await
        .map_err(|e| format!("office stop task failed: {e}"))
}

/// Stop the office if it is running. Also Buzz's shutdown path.
pub(crate) fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<OfficeState>() {
        if let Some(running) = state.running.lock().ok().and_then(|mut g| g.take()) {
            stop_running(running);
            crate::commands::set_office_agent_deployed(app, false);
        }
    }
}
