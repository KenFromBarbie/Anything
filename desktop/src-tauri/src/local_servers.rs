//! Local servers: communities that run on this computer instead of a hosted
//! relay.
//!
//! Each one is its own `buzz-relay` process on its own port
//! (`ws://localhost:<port>`), sharing the local Postgres and Redis of the
//! development stack; the relay keeps communities apart in both by host, so
//! the servers never see each other's data. The relay seeds the community for
//! its own address on start and makes the creator its owner.
//!
//! The app starts the servers it knows (`<app data>/local-servers.json`) when
//! it starts, and stops them when it quits.
//!
//! The relay binary and its settings come from the source checkout: the
//! repository is the parent of `BUZZ_OFFICE_DIR` (the development launch sets
//! it), or `BUZZ_LOCAL_RELAY_BIN` / `BUZZ_LOCAL_RELAY_ENV` point at them.

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const REGISTRY_FILE: &str = "local-servers.json";
const FIRST_PORT: u16 = 3001;
const LAST_PORT: u16 = 3099;
const HEALTH_BASE: u16 = 18000;
const METRICS_BASE: u16 = 19000;
const READY_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalServer {
    pub name: String,
    pub port: u16,
}

impl LocalServer {
    fn relay_url(&self) -> String {
        format!("ws://localhost:{}", self.port)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedLocalServer {
    name: String,
    relay_url: String,
}

/// The relay processes this app started (port → process).
#[derive(Default)]
pub struct LocalServers {
    running: Mutex<Vec<(u16, Child)>>,
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join(REGISTRY_FILE))
}

fn load_registry(app: &AppHandle) -> Vec<LocalServer> {
    registry_path(app)
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_registry(app: &AppHandle, servers: &[LocalServer]) -> Result<(), String> {
    let path = registry_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(servers).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("save local servers: {e}"))
}

/// The relay binary and its settings file.
fn relay_setup() -> Result<(PathBuf, PathBuf), String> {
    let repo = std::env::var_os("BUZZ_OFFICE_DIR")
        .map(PathBuf::from)
        .and_then(|office| office.parent().map(Path::to_path_buf));
    let bin_name = if cfg!(target_os = "windows") {
        "buzz-relay.exe"
    } else {
        "buzz-relay"
    };
    let bin = std::env::var_os("BUZZ_LOCAL_RELAY_BIN")
        .map(PathBuf::from)
        .or_else(|| repo.as_ref().map(|r| r.join("target").join("debug").join(bin_name)));
    let env = std::env::var_os("BUZZ_LOCAL_RELAY_ENV")
        .map(PathBuf::from)
        .or_else(|| repo.as_ref().map(|r| r.join(".env")));
    match (bin, env) {
        (Some(bin), Some(env)) if bin.is_file() && env.is_file() => Ok((bin, env)),
        _ => Err(
            "Local servers need the local relay (buzz-relay) and its settings from the \
             source checkout, which weren't found."
                .into(),
        ),
    }
}

/// `KEY=VALUE` lines, as the services script reads them.
fn read_env_file(path: &Path) -> Vec<(String, String)> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            let valid = !key.is_empty()
                && key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_')
                && !key.starts_with(|c: char| c.is_ascii_digit());
            valid.then(|| (key.to_string(), value.trim().trim_matches('"').to_string()))
        })
        .collect()
}

fn port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .is_ok()
}

fn owner_pubkey(app: &AppHandle) -> Option<String> {
    let state = app.state::<crate::app_state::AppState>();
    let keys = state.keys.lock().ok()?;
    Some(keys.public_key().to_hex())
}

fn log_file(app: &AppHandle, port: u16) -> Option<std::fs::File> {
    let dir = app.path().app_data_dir().ok()?.join("local-servers");
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::File::create(dir.join(format!("relay-{port}.log"))).ok()
}

/// Start one server's relay (if its port isn't already serving) and wait
/// until it listens.
fn start_server(app: &AppHandle, server: &LocalServer) -> Result<(), String> {
    if port_in_use(server.port) {
        return Ok(());
    }
    let (bin, env_file) = relay_setup()?;
    let offset = server.port - 3000;
    let mut cmd = Command::new(&bin);
    if let Some(dir) = env_file.parent() {
        cmd.current_dir(dir);
    }
    for (key, value) in read_env_file(&env_file) {
        cmd.env(key, value);
    }
    cmd.env("BUZZ_BIND_ADDR", format!("127.0.0.1:{}", server.port))
        .env("RELAY_URL", server.relay_url())
        .env("BUZZ_HEALTH_PORT", (HEALTH_BASE + offset).to_string())
        .env("BUZZ_METRICS_PORT", (METRICS_BASE + offset).to_string())
        // Needs S3 (MinIO), which the local stack doesn't run.
        .env("BUZZ_GIT_CONFORMANCE_PROBE", "false");
    if let Some(owner) = owner_pubkey(app) {
        cmd.env("RELAY_OWNER_PUBKEY", owner);
    }
    let log = log_file(app, server.port);
    cmd.stdin(Stdio::null())
        .stdout(
            log.as_ref()
                .and_then(|f| f.try_clone().ok())
                .map(Stdio::from)
                .unwrap_or_else(Stdio::null),
        )
        .stderr(log.map(Stdio::from).unwrap_or_else(Stdio::null));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("start the local server: {e}"))?;
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        if port_in_use(server.port) {
            break;
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "The local server stopped while starting ({status}); see local-servers/relay-{}.log in the app's data folder.",
                server.port
            ));
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err("The local server didn't start in time.".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    if let Ok(mut running) = app.state::<LocalServers>().running.lock() {
        running.push((server.port, child));
    }
    Ok(())
}

/// A free port for a new server.
fn free_port(servers: &[LocalServer]) -> Option<u16> {
    (FIRST_PORT..=LAST_PORT).find(|port| {
        let offset = port - 3000;
        !servers.iter().any(|s| s.port == *port)
            && !port_in_use(*port)
            && !port_in_use(HEALTH_BASE + offset)
            && !port_in_use(METRICS_BASE + offset)
    })
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the server a name.".into());
    }
    if name.chars().count() > 60 {
        return Err("That name is too long (60 characters at most).".into());
    }
    Ok(name.to_string())
}

/// Create a server on this computer and start it; returns its address.
#[tauri::command]
pub async fn local_server_create(app: AppHandle, name: String) -> Result<CreatedLocalServer, String> {
    let name = clean_name(&name)?;
    relay_setup()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut servers = load_registry(&app);
        let port = free_port(&servers).ok_or("No free port for another local server.")?;
        let server = LocalServer { name: name.clone(), port };
        start_server(&app, &server)?;
        servers.push(server.clone());
        save_registry(&app, &servers)?;
        Ok(CreatedLocalServer {
            name,
            relay_url: server.relay_url(),
        })
    })
    .await
    .map_err(|e| format!("local server task failed: {e}"))?
}

/// Whether servers can be made on this computer (the local relay is there).
#[tauri::command]
pub fn local_servers_available() -> bool {
    relay_setup().is_ok()
}

/// At launch: start every local server this app made.
pub fn start_all(app: &AppHandle) {
    let servers = load_registry(app);
    if servers.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for server in servers {
            if let Err(error) = start_server(&app, &server) {
                eprintln!("buzz-desktop: local server {}: {error}", server.name);
            }
        }
    });
}

/// At quit: stop the servers this app started.
pub fn shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<LocalServers>() else {
        return;
    };
    let Ok(mut running) = state.running.lock() else {
        return;
    };
    for (_, mut child) in running.drain(..) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_files_are_read_like_the_services_script() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".env");
        std::fs::write(
            &path,
            "# comment\nDATABASE_URL=\"postgres://x\"\n\nRUST_LOG=info\n1BAD=x\nbad-key=y\n",
        )
        .unwrap();
        assert_eq!(
            read_env_file(&path),
            vec![
                ("DATABASE_URL".to_string(), "postgres://x".to_string()),
                ("RUST_LOG".to_string(), "info".to_string()),
            ]
        );
    }

    #[test]
    fn names_are_trimmed_and_required() {
        assert_eq!(clean_name("  Studio crew ").unwrap(), "Studio crew");
        assert!(clean_name("   ").is_err());
        assert!(clean_name(&"x".repeat(61)).is_err());
    }

    #[test]
    fn servers_live_on_localhost_ports() {
        let server = LocalServer { name: "A".into(), port: 3004 };
        assert_eq!(server.relay_url(), "ws://localhost:3004");
    }
}
