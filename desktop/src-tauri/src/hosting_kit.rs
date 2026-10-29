//! The hosting kit: what lets an installed app host servers on this computer
//! without the developer stack. The installers carry, under the app's
//! resources (`hosting/`), the relay (`relay/buzz-relay`), a portable
//! Postgres (`postgres/bin/...`) and a self-contained Garnet (`garnet/`, the
//! Redis-compatible cache). On first use the app creates a private database
//! in its data folder, then starts Postgres, Garnet and a built-in S3-style
//! file store (`hosting_media`) on free loopback ports, and hands the relay
//! the settings to use them. Nothing listens beyond this computer.
//!
//! Everything it makes lives in `<app data>/hosting/`: `pgdata/`, `media/`,
//! logs, and `hosting.json` (ports, the database password and the relay's
//! key, created once).

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const START_TIMEOUT: Duration = Duration::from_secs(60);
const DB_USER: &str = "anything";
const MEDIA_BUCKET: &str = "buzz-media";

/// The bundled programs, when this build carries them.
pub struct Kit {
    pub relay: PathBuf,
    postgres_bin: PathBuf,
    garnet: PathBuf,
    /// Linux builds carry the kit zipped (`hosting/kit.zip`: the AppImage
    /// packager chokes on the programs' libraries otherwise); it's unpacked
    /// into the app's data folder before first use.
    archive: Option<(PathBuf, PathBuf)>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    pg_port: u16,
    redis_port: u16,
    media_port: u16,
    pg_password: String,
    relay_key: String,
}

/// The services this app started (stopped at quit).
#[derive(Default)]
pub struct HostingServices {
    children: Mutex<Vec<(&'static str, Child)>>,
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// A Windows path without the `\\?\` verbatim prefix Tauri's path API can
/// return: Postgres's tools can't find their own programs through it (initdb
/// failed with "program postgres is needed ... but was not found").
fn plain(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.chars().nth(1) == Some(':') => PathBuf::from(rest),
        _ => path,
    }
}

fn kit_in(dir: &Path, archive: Option<(PathBuf, PathBuf)>) -> Kit {
    Kit {
        relay: dir.join("relay").join(exe("buzz-relay")),
        postgres_bin: dir.join("postgres").join("bin"),
        garnet: dir.join("garnet").join(exe("GarnetServer")),
        archive,
    }
}

/// The kit: this build's own (older installers carried it), else the
/// downloaded `hosting` component (see `components`; `local_server_create`
/// fetches it the first time a server is made here).
pub fn find(app: &AppHandle) -> Option<Kit> {
    bundled_kit(app).or_else(|| {
        let dir = crate::components::ready(app, crate::components::Component::Hosting)?;
        let kit = kit_in(&dir, None);
        kit.ensure_executable();
        kit.relay.is_file().then_some(kit)
    })
}

/// Whether this build carries the kit itself.
pub fn bundled(app: &AppHandle) -> bool {
    bundled_kit(app).is_some()
}

/// The kit in this build's resources, if it has one. Cheap: a zipped kit is
/// only unpacked by `prepare` (from `ensure_running`).
fn bundled_kit(app: &AppHandle) -> Option<Kit> {
    let dir = plain(app.path().resource_dir().ok()?).join("hosting");
    let zipped = dir.join("kit.zip");
    if zipped.is_file() {
        // Unpacked per build (by the archive's size), so an update unpacks anew.
        let size = std::fs::metadata(&zipped).ok()?.len();
        let dest = data_dir(app).ok()?.join(format!("kit-{size}"));
        return Some(kit_in(&dest, Some((zipped, dest.clone()))));
    }
    let kit = kit_in(&dir, None);
    let complete = kit.relay.is_file()
        && kit.postgres_bin.join(exe("postgres")).is_file()
        && kit.garnet.is_file();
    if complete {
        kit.ensure_executable();
    }
    complete.then_some(kit)
}

impl Kit {
    /// Unpack a zipped kit on first use (once per build).
    fn prepare(&self) -> Result<(), String> {
        let Some((zipped, dest)) = &self.archive else {
            return Ok(());
        };
        let done = dest.join(".unpacked");
        if !done.is_file() {
            let _ = std::fs::remove_dir_all(dest);
            std::fs::create_dir_all(dest).map_err(|e| format!("make {}: {e}", dest.display()))?;
            let file =
                std::fs::File::open(zipped).map_err(|e| format!("open the hosting kit: {e}"))?;
            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| format!("read the hosting kit: {e}"))?;
            archive
                .extract(dest)
                .map_err(|e| format!("unpack the hosting kit: {e}"))?;
            std::fs::write(&done, b"").map_err(|e| e.to_string())?;
        }
        self.ensure_executable();
        Ok(())
    }

    /// Packaging can drop the executable bit on macOS and Linux; put it back
    /// (best effort: a read-only install that kept it needs nothing).
    fn ensure_executable(&self) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut files = vec![self.relay.clone(), self.garnet.clone()];
            if let Ok(entries) = std::fs::read_dir(&self.postgres_bin) {
                files.extend(entries.filter_map(|e| e.ok()).map(|e| e.path()));
            }
            for file in files {
                if let Ok(meta) = std::fs::metadata(&file) {
                    let mode = meta.permissions().mode();
                    if meta.is_file() && mode & 0o111 == 0 {
                        let _ = std::fs::set_permissions(
                            &file,
                            std::fs::Permissions::from_mode(mode | 0o755),
                        );
                    }
                }
            }
        }
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = plain(
        app.path()
            .app_data_dir()
            .map_err(|e| format!("no app data folder: {e}"))?,
    )
    .join("hosting");
    std::fs::create_dir_all(&dir).map_err(|e| format!("make {}: {e}", dir.display()))?;
    Ok(dir)
}

fn listening(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// A free loopback port at or after `from`.
fn free_port(from: u16) -> Option<u16> {
    (from..from.saturating_add(200))
        .find(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok() && !listening(*port))
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("the OS random source");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// The kit's settings, made once (ports re-picked if one was taken since).
fn settings(dir: &Path, ours_running: bool) -> Result<Settings, String> {
    let file = dir.join("hosting.json");
    let mut settings: Settings = match std::fs::read_to_string(&file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
    {
        Some(saved) => saved,
        None => Settings {
            pg_port: free_port(15432).ok_or("no free port for the database")?,
            redis_port: free_port(16379).ok_or("no free port for the cache")?,
            media_port: free_port(19450).ok_or("no free port for the file store")?,
            pg_password: random_hex(24),
            relay_key: nostr::Keys::generate().secret_key().to_secret_hex(),
        },
    };
    // A port something else took since: pick another (ours isn't running yet).
    if !ours_running {
        // Another database there (an older install's, say) would turn the
        // relay away with a wrong password; ours, still up from an earlier
        // run, is used as it is.
        if listening(settings.pg_port) && !our_database_on(dir, settings.pg_port) {
            settings.pg_port =
                free_port(settings.pg_port + 1).ok_or("no free port for the database")?;
        }
        if listening(settings.redis_port) {
            settings.redis_port =
                free_port(settings.redis_port + 1).ok_or("no free port for the cache")?;
        }
        if listening(settings.media_port) {
            settings.media_port =
                free_port(settings.media_port + 1).ok_or("no free port for the file store")?;
        }
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    crate::managed_agents::storage::atomic_write_json(&file, text.as_bytes())?;
    Ok(settings)
}

/// Whether the Postgres listening on `port` runs on this folder's data: its
/// lock file names the port (fourth line).
fn our_database_on(dir: &Path, port: u16) -> bool {
    std::fs::read_to_string(dir.join("pgdata").join("postmaster.pid"))
        .ok()
        .and_then(|pid| pid.lines().nth(3).map(|line| line.trim() == port.to_string()))
        .unwrap_or(false)
}

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn log_to(dir: &Path, name: &str) -> (Stdio, Stdio) {
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(format!("{name}.log")))
    {
        Ok(file) => {
            let err = file
                .try_clone()
                .map(Stdio::from)
                .unwrap_or_else(|_| Stdio::null());
            (Stdio::from(file), err)
        }
        Err(_) => (Stdio::null(), Stdio::null()),
    }
}

fn wait_listening(port: u16, child: &mut Child, what: &str) -> Result<(), String> {
    let deadline = Instant::now() + START_TIMEOUT;
    while !listening(port) {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("the {what} stopped while starting ({status})"));
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err(format!("the {what} didn't start in time"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(())
}

/// Create the database cluster on first use.
fn init_database(kit: &Kit, dir: &Path, settings: &Settings) -> Result<(), String> {
    let pgdata = dir.join("pgdata");
    if pgdata.join("PG_VERSION").is_file() {
        return Ok(());
    }
    let pwfile = dir.join("pg-init-password.tmp");
    std::fs::write(&pwfile, &settings.pg_password).map_err(|e| e.to_string())?;
    let (out, err) = log_to(dir, "postgres-init");
    let status = quiet(
        Command::new(kit.postgres_bin.join(exe("initdb")))
            .arg("-D")
            .arg(&pgdata)
            .args([
                "-U",
                DB_USER,
                "-A",
                "scram-sha-256",
                "-E",
                "UTF8",
                "--locale=C",
            ])
            .arg(format!("--pwfile={}", pwfile.display()))
            .stdout(out)
            .stderr(err),
    )
    .status()
    .map_err(|e| format!("couldn't set up the database: {e}"));
    let _ = std::fs::remove_file(&pwfile);
    match status? {
        s if s.success() => Ok(()),
        s => {
            let _ = std::fs::remove_dir_all(&pgdata);
            Err(format!(
                "setting up the database failed ({s}); see hosting/postgres-init.log"
            ))
        }
    }
}

fn start_database(
    services: &HostingServices,
    kit: &Kit,
    dir: &Path,
    settings: &Settings,
) -> Result<(), String> {
    if listening(settings.pg_port) {
        return Ok(());
    }
    let (out, err) = log_to(dir, "postgres");
    let mut child = quiet(
        Command::new(kit.postgres_bin.join(exe("postgres")))
            .arg("-D")
            .arg(dir.join("pgdata"))
            .args(["-p", &settings.pg_port.to_string()])
            .args(["-c", "listen_addresses=127.0.0.1"])
            // Every server on this computer is its own relay on this one
            // database, ~21 connections each (local_servers.rs sizes their
            // pools): room for many.
            .args(["-c", "max_connections=400"])
            .stdin(Stdio::null())
            .stdout(out)
            .stderr(err),
    )
    .spawn()
    .map_err(|e| format!("couldn't start the database: {e}"))?;
    crate::app_job::tie_to_app(child.id());
    wait_listening(settings.pg_port, &mut child, "database")?;
    services.remember("postgres", child);
    Ok(())
}

fn start_cache(
    services: &HostingServices,
    kit: &Kit,
    dir: &Path,
    settings: &Settings,
) -> Result<(), String> {
    if listening(settings.redis_port) {
        return Ok(());
    }
    let (out, err) = log_to(dir, "garnet");
    let mut child = quiet(
        Command::new(&kit.garnet)
            .args([
                "--bind",
                "127.0.0.1",
                "--port",
                &settings.redis_port.to_string(),
            ])
            .args(["--lua", "-m", "256m"])
            .stdin(Stdio::null())
            .stdout(out)
            .stderr(err),
    )
    .spawn()
    .map_err(|e| format!("couldn't start the cache: {e}"))?;
    crate::app_job::tie_to_app(child.id());
    wait_listening(settings.redis_port, &mut child, "cache")?;
    services.remember("garnet", child);
    Ok(())
}

impl HostingServices {
    fn remember(&self, name: &'static str, child: Child) {
        if let Ok(mut children) = self.children.lock() {
            children.push((name, child));
        }
    }
    fn any_running(&self) -> bool {
        self.children.lock().map(|c| !c.is_empty()).unwrap_or(false)
    }
}

/// Start what the relay needs (idempotent) and return its settings, as
/// `KEY=VALUE` pairs for its environment.
pub fn ensure_running(app: &AppHandle, kit: &Kit) -> Result<Vec<(String, String)>, String> {
    start_services(&app.state::<HostingServices>(), kit, &data_dir(app)?)
}

/// The work behind `ensure_running`, given where things live.
fn start_services(
    services: &HostingServices,
    kit: &Kit,
    dir: &Path,
) -> Result<Vec<(String, String)>, String> {
    kit.prepare()?;
    let settings = settings(dir, services.any_running())?;
    init_database(kit, dir, &settings)?;
    start_database(services, kit, dir, &settings)?;
    start_cache(services, kit, dir, &settings)?;
    crate::hosting_media::ensure_running(dir.join("media"), settings.media_port)?;
    Ok(vec![
        (
            "DATABASE_URL".into(),
            format!(
                "postgres://{DB_USER}:{}@127.0.0.1:{}/postgres",
                settings.pg_password, settings.pg_port
            ),
        ),
        (
            "REDIS_URL".into(),
            format!("redis://127.0.0.1:{}", settings.redis_port),
        ),
        (
            "BUZZ_S3_ENDPOINT".into(),
            format!("http://127.0.0.1:{}", settings.media_port),
        ),
        ("BUZZ_S3_ACCESS_KEY".into(), "anything".into()),
        ("BUZZ_S3_SECRET_KEY".into(), "anything-local".into()),
        ("BUZZ_S3_BUCKET".into(), MEDIA_BUCKET.into()),
        ("BUZZ_S3_REGION".into(), "us-east-1".into()),
        ("BUZZ_S3_ADDRESSING_STYLE".into(), "path".into()),
        ("BUZZ_RELAY_PRIVATE_KEY".into(), settings.relay_key),
        // Tables are created on first start and upgraded with the app.
        ("BUZZ_AUTO_MIGRATE".into(), "true".into()),
        ("BUZZ_PUSH_ENABLED".into(), "false".into()),
        ("RUST_LOG".into(), "buzz_relay=info".into()),
    ])
}

/// At quit: stop the database cleanly, then the cache.
pub fn shutdown(app: &AppHandle, kit: Option<&Kit>) {
    let Some(state) = app.try_state::<HostingServices>() else {
        return;
    };
    stop_services(&state, kit, data_dir(app).ok().as_deref());
}

fn stop_services(services: &HostingServices, kit: Option<&Kit>, dir: Option<&Path>) {
    let Ok(mut children) = services.children.lock() else {
        return;
    };
    for (name, mut child) in children.drain(..) {
        if name == "postgres" {
            if let (Some(kit), Some(dir)) = (kit, dir) {
                // A fast shutdown flushes and closes the database properly.
                let stopped = quiet(
                    Command::new(kit.postgres_bin.join(exe("pg_ctl")))
                        .args(["stop", "-m", "fast", "-w", "-D"])
                        .arg(dir.join("pgdata"))
                        .stdout(Stdio::null())
                        .stderr(Stdio::null()),
                )
                .status()
                .is_ok_and(|s| s.success());
                if stopped {
                    let _ = child.wait();
                    continue;
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_database_on_our_data_counts_as_ours() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!our_database_on(dir.path(), 15432));
        std::fs::create_dir_all(dir.path().join("pgdata")).unwrap();
        std::fs::write(
            dir.path().join("pgdata").join("postmaster.pid"),
            "1234
C:/data/pgdata
1700000000
15432

127.0.0.1
",
        )
        .unwrap();
        assert!(our_database_on(dir.path(), 15432));
        assert!(!our_database_on(dir.path(), 15433));
    }

    #[test]
    fn verbatim_windows_paths_become_plain() {
        assert_eq!(
            plain(PathBuf::from(r"\\?\C:\Users\a\AppData\Local\Anything")),
            PathBuf::from(r"C:\Users\a\AppData\Local\Anything")
        );
        assert_eq!(
            plain(PathBuf::from(r"\\?\UNC\srv\share")),
            PathBuf::from(r"\\srv\share")
        );
        assert_eq!(
            plain(PathBuf::from("/usr/lib/anything")),
            PathBuf::from("/usr/lib/anything")
        );
    }

    /// The whole kit against real programs: a private database, the cache,
    /// the file store, then a relay that sets up its tables and listens.
    /// Needs the programs on this machine, so it's opt-in:
    /// `ANYTHING_KIT_TEST_RELAY`, `ANYTHING_KIT_TEST_PG_BIN` (Postgres bin/)
    /// and `ANYTHING_KIT_TEST_GARNET`, then
    /// `cargo test -p buzz-desktop --lib hosting_kit -- --ignored`.
    #[test]
    #[ignore]
    fn the_kit_hosts_a_relay() {
        let var = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("set {k}"));
        let kit = Kit {
            relay: PathBuf::from(var("ANYTHING_KIT_TEST_RELAY")),
            postgres_bin: PathBuf::from(var("ANYTHING_KIT_TEST_PG_BIN")),
            garnet: PathBuf::from(var("ANYTHING_KIT_TEST_GARNET")),
            archive: None,
        };
        let dir = tempfile::tempdir().unwrap();
        let services = HostingServices::default();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let _guard = runtime.enter();
        let env = start_services(&services, &kit, dir.path()).expect("services start");

        let port = free_port(3190).unwrap();
        let mut relay = quiet(
            Command::new(&kit.relay)
                .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
                .env("BUZZ_BIND_ADDR", format!("127.0.0.1:{port}"))
                .env("RELAY_URL", format!("ws://localhost:{port}"))
                .env("BUZZ_HEALTH_PORT", free_port(18190).unwrap().to_string())
                .env("BUZZ_METRICS_PORT", free_port(19190).unwrap().to_string())
                .env("BUZZ_GIT_CONFORMANCE_PROBE", "false")
                .stdout(Stdio::from(
                    std::fs::File::create(dir.path().join("relay.log")).unwrap(),
                ))
                .stderr(Stdio::from(
                    std::fs::File::create(dir.path().join("relay.err.log")).unwrap(),
                )),
        )
        .spawn()
        .unwrap();
        let started = wait_listening(port, &mut relay, "relay");
        let log = std::fs::read_to_string(dir.path().join("relay.log")).unwrap_or_default()
            + &std::fs::read_to_string(dir.path().join("relay.err.log")).unwrap_or_default();
        let _ = relay.kill();
        let _ = relay.wait();
        stop_services(&services, Some(&kit), Some(dir.path()));
        started.unwrap_or_else(|e| {
            panic!(
                "relay: {e}
{}",
                &log[log.len().saturating_sub(4000)..]
            )
        });
        assert!(
            log.contains("Database migrations complete"),
            "no migrations in:
{log}"
        );
    }
}
