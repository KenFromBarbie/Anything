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
//! The relay binary and its settings come from the source checkout when there
//! is one: the repository is the parent of `BUZZ_OFFICE_DIR` (the development
//! launch sets it), or `BUZZ_LOCAL_RELAY_BIN` / `BUZZ_LOCAL_RELAY_ENV` point
//! at them. An installed app uses its bundled hosting kit instead
//! (`hosting_kit`: its own Postgres, cache and file store).

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
/// Database connections per pool for a local server's relay.
const LOCAL_RELAY_POOL: &str = "8";

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
        .or_else(|| {
            repo.as_ref()
                .map(|r| r.join("target").join("debug").join(bin_name))
        });
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
                && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
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

/// Where a relay comes from: the source checkout, or the bundled kit.
enum RelaySource {
    Checkout { bin: PathBuf, env_file: PathBuf },
    Kit(crate::hosting_kit::Kit),
}

fn relay_source(app: &AppHandle) -> Result<RelaySource, String> {
    match relay_setup() {
        Ok((bin, env_file)) => Ok(RelaySource::Checkout { bin, env_file }),
        Err(error) => crate::hosting_kit::find(app)
            .map(RelaySource::Kit)
            .ok_or(error),
    }
}

/// Start one server's relay (if its port isn't already serving) and wait
/// until it listens.
fn start_server(app: &AppHandle, server: &LocalServer) -> Result<(), String> {
    if port_in_use(server.port) {
        return Ok(());
    }
    let offset = server.port - 3000;
    let mut cmd = match relay_source(app)? {
        RelaySource::Checkout { bin, env_file } => {
            let mut cmd = Command::new(&bin);
            if let Some(dir) = env_file.parent() {
                cmd.current_dir(dir);
            }
            for (key, value) in read_env_file(&env_file) {
                cmd.env(key, value);
            }
            cmd
        }
        RelaySource::Kit(kit) => {
            // The kit's database, cache and file store, started on demand.
            let env = crate::hosting_kit::ensure_running(app, &kit)?;
            let mut cmd = Command::new(&kit.relay);
            if let Some(dir) = kit.relay.parent() {
                cmd.current_dir(dir);
            }
            for (key, value) in env {
                cmd.env(key, value);
            }
            cmd
        }
    };
    cmd.env("BUZZ_BIND_ADDR", format!("127.0.0.1:{}", server.port))
        .env("RELAY_URL", server.relay_url())
        .env("BUZZ_HEALTH_PORT", (HEALTH_BASE + offset).to_string())
        .env("BUZZ_METRICS_PORT", (METRICS_BASE + offset).to_string())
        // Needs S3 (MinIO), which the local stack doesn't run.
        .env("BUZZ_GIT_CONFORMANCE_PROBE", "false")
        // Each server is a small relay sharing one database with the others
        // (and, in development, the main relay): the default pool of 50
        // would let two of them use up its 100 connections.
        .env("BUZZ_DB_POOL_SIZE", LOCAL_RELAY_POOL)
        .env("BUZZ_DB_READ_POOL_SIZE", LOCAL_RELAY_POOL)
        .env("BUZZ_REDIS_POOL_SIZE", "4");
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
    crate::app_job::tie_to_app(child.id());
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
        // Drop this port's earlier relay if it has exited (the supervisor
        // restarted it), so the list doesn't grow.
        running
            .retain_mut(|(port, old)| *port != server.port || matches!(old.try_wait(), Ok(None)));
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
pub async fn local_server_create(
    app: AppHandle,
    name: String,
) -> Result<CreatedLocalServer, String> {
    let name = clean_name(&name)?;
    // The first server made here: fetch the hosting kit if this build
    // doesn't carry it (the page shows the download's progress).
    if relay_setup().is_err() && crate::hosting_kit::find(&app).is_none() {
        crate::components::ensure(&app, crate::components::Component::Hosting).await?;
    }
    relay_source(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut servers = load_registry(&app);
        let port = free_port(&servers).ok_or("No free port for another local server.")?;
        let server = LocalServer {
            name: name.clone(),
            port,
        };
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

/// A work folder for a new server's agents: `~/Anything/<name>` (made if
/// missing; a name that can't be a folder becomes "Server").
#[tauri::command]
pub fn server_work_folder(app: AppHandle, name: String) -> Result<String, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("no home folder: {e}"))?;
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                ' '
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let folder = home.join("Anything").join(if cleaned.is_empty() {
        "Server".to_string()
    } else {
        cleaned
    });
    std::fs::create_dir_all(&folder).map_err(|e| format!("make {}: {e}", folder.display()))?;
    Ok(folder.to_string_lossy().into_owned())
}

/// Whether servers can be made on this computer: the source checkout's relay,
/// or the hosting kit an installed app carries.
#[tauri::command]
pub fn local_servers_available(app: AppHandle) -> bool {
    // Without a kit here yet, making a server downloads it.
    let _ = app;
    true
}

/// How often the local servers are checked and restarted if down.
const SUPERVISE_EVERY: Duration = Duration::from_secs(15);
/// Set at quit, so the supervisor doesn't restart what's being stopped.
static STOPPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// At launch: start every local server this app made, and keep them up.
///
/// Kept up, not just started once: at launch a relay from the previous run
/// can still hold its port for a moment (so it was skipped) and then exit,
/// leaving the server unreachable. Any that isn't listening is restarted,
/// which also brings back one that crashed.
pub fn start_all(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        use std::sync::atomic::Ordering;
        // Servers made here before the hosting kit left the installer: fetch
        // the kit first (once; later passes retry if this one fails).
        let mut fetched = false;
        while !STOPPING.load(Ordering::Acquire) {
            if !fetched
                && relay_setup().is_err()
                && crate::hosting_kit::find(&app).is_none()
                && !load_registry(&app).is_empty()
            {
                match tauri::async_runtime::block_on(crate::components::ensure(
                    &app,
                    crate::components::Component::Hosting,
                )) {
                    Ok(_) => fetched = true,
                    Err(error) => eprintln!("buzz-desktop: hosting kit: {error}"),
                }
            }
            for server in load_registry(&app) {
                if STOPPING.load(Ordering::Acquire) {
                    return;
                }
                if let Err(error) = start_server(&app, &server) {
                    eprintln!("buzz-desktop: local server {}: {error}", server.name);
                }
            }
            std::thread::sleep(SUPERVISE_EVERY);
        }
    });
}

/// At quit: stop the servers this app started.
pub fn shutdown(app: &AppHandle) {
    STOPPING.store(true, std::sync::atomic::Ordering::Release);
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
        let server = LocalServer {
            name: "A".into(),
            port: 3004,
        };
        assert_eq!(server.relay_url(), "ws://localhost:3004");
    }
}
