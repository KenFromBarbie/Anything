//! AI accounts for the agents (Settings → AI accounts): the Claude, ChatGPT
//! (Codex) and Google (Gemini) subscriptions the Office's agents run on.
//!
//! Each account is a home folder for its CLI — a CLAUDE_CONFIG_DIR, a
//! CODEX_HOME, a GEMINI_CLI_HOME — under `<app data>/ai-accounts/<engine>/<id>`;
//! "This computer" is the CLI's normal sign-in. Signing in runs the CLI's own
//! login in a terminal with that home set, so credentials only ever go where
//! the CLI puts them; Buzz reads back who is signed in (email, plan), never the
//! tokens. The active choice per engine is written to `active.json`, which the
//! Office reads when it starts an agent (BUZZ_AI_ACCOUNTS_FILE).
//!
//! Usage comes from what each CLI logs locally: Claude Code's transcripts,
//! Codex's session logs (which also carry the plan's limit percentages), and
//! Gemini CLI's chat logs. Agents' Codex sessions are shared across accounts,
//! so they're attributed by which account was active when they ran.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Engine {
    Claude,
    Codex,
    Gemini,
}

const ENGINES: [Engine; 3] = [Engine::Claude, Engine::Codex, Engine::Gemini];

impl Engine {
    fn parse(value: &str) -> Result<Engine, String> {
        match value {
            "claude" => Ok(Engine::Claude),
            "codex" => Ok(Engine::Codex),
            "gemini" => Ok(Engine::Gemini),
            other => Err(format!("unknown engine {other}")),
        }
    }
    fn key(self) -> &'static str {
        match self {
            Engine::Claude => "claude",
            Engine::Codex => "codex",
            Engine::Gemini => "gemini",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Engine::Claude => "Claude",
            Engine::Codex => "ChatGPT",
            Engine::Gemini => "Google",
        }
    }
    fn cli(self) -> &'static str {
        match self {
            Engine::Claude => "claude",
            Engine::Codex => "codex",
            Engine::Gemini => "gemini",
        }
    }
    fn home_var(self) -> &'static str {
        match self {
            Engine::Claude => "CLAUDE_CONFIG_DIR",
            Engine::Codex => "CODEX_HOME",
            Engine::Gemini => "GEMINI_CLI_HOME",
        }
    }
    fn login_command(self) -> &'static str {
        match self {
            Engine::Claude => "claude /login",
            Engine::Codex => "codex login",
            Engine::Gemini => "gemini",
        }
    }
    /// The CLI's own home when no account is picked.
    fn default_home(self) -> PathBuf {
        let home = dirs::home_dir().unwrap_or_default();
        match self {
            Engine::Claude => home.join(".claude"),
            Engine::Codex => home.join(".codex"),
            Engine::Gemini => home,
        }
    }
}

// ─── Registry ────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    label: String,
    created_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
struct Switch {
    /// Unix milliseconds.
    at: i64,
    /// None: this computer's own sign-in.
    id: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct EngineRegistry {
    #[serde(default)]
    active: Option<String>,
    #[serde(default)]
    profiles: Vec<Profile>,
    #[serde(default)]
    history: Vec<Switch>,
}

#[derive(Default, Serialize, Deserialize)]
struct Registry {
    #[serde(default)]
    engines: HashMap<String, EngineRegistry>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("ai-accounts");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn profile_dir(app: &AppHandle, engine: Engine, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid account id".into());
    }
    Ok(root(app)?.join(engine.key()).join(id))
}

fn load_registry(app: &AppHandle) -> Registry {
    root(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("accounts.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("save {}: {e}", path.display()))
}

/// Save the registry and the Office's view of it (active.json).
fn save_registry(app: &AppHandle, registry: &Registry) -> Result<(), String> {
    let dir = root(app)?;
    write_atomic(
        &dir.join("accounts.json"),
        &serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?,
    )?;
    write_active(app, registry)
}

fn write_active(app: &AppHandle, registry: &Registry) -> Result<(), String> {
    let mut active = serde_json::Map::new();
    for engine in ENGINES {
        let home = registry
            .engines
            .get(engine.key())
            .and_then(|e| e.active.as_deref())
            .and_then(|id| profile_dir(app, engine, id).ok())
            .filter(|dir| dir.is_dir())
            .map(|dir| Value::String(dir.to_string_lossy().into_owned()))
            .unwrap_or(Value::Null);
        active.insert(engine.key().to_string(), home);
    }
    write_atomic(
        &root(app)?.join("active.json"),
        &serde_json::to_string_pretty(&Value::Object(active)).map_err(|e| e.to_string())?,
    )
}

/// The file the Office reads to start agents on the chosen accounts.
pub fn active_file(app: &AppHandle) -> Option<PathBuf> {
    let path = root(app).ok()?.join("active.json");
    if !path.is_file() {
        let _ = write_active(app, &load_registry(app));
    }
    Some(path)
}

// ─── Who is signed in (never the tokens) ─────────────────────────────────────

#[derive(Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Identity {
    signed_in: bool,
    email: Option<String>,
    name: Option<String>,
    organization: Option<String>,
    plan: Option<String>,
}

fn read_json(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn str_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut v = value;
    for key in path {
        v = v.get(*key)?;
    }
    v.as_str().filter(|s| !s.is_empty()).map(String::from)
}

/// The claims of a JWT (unverified — only to show who's signed in).
fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn identity(engine: Engine, home: &Path, is_default: bool) -> Identity {
    match engine {
        Engine::Claude => {
            let state_file = if is_default {
                dirs::home_dir().unwrap_or_default().join(".claude.json")
            } else {
                home.join(".claude.json")
            };
            let state = read_json(&state_file).unwrap_or(Value::Null);
            let creds = read_json(&home.join(".credentials.json")).unwrap_or(Value::Null);
            let account = state.get("oauthAccount").cloned().unwrap_or(Value::Null);
            let has_token = creds
                .get("claudeAiOauth")
                .and_then(|o| o.get("accessToken"))
                .and_then(Value::as_str)
                .is_some_and(|t| !t.is_empty());
            let plan = str_at(&creds, &["claudeAiOauth", "subscriptionType"])
                .map(|p| {
                    let mut c = p.chars();
                    c.next()
                        .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                        .unwrap_or(p)
                })
                .or_else(|| str_at(&account, &["billingType"]));
            if !is_default && uses_api_key(Engine::Claude, home) {
                return Identity {
                    signed_in: true,
                    plan: Some("API key".into()),
                    ..Identity::default()
                };
            }
            Identity {
                signed_in: has_token || !account.is_null(),
                email: str_at(&account, &["emailAddress"]),
                name: str_at(&account, &["displayName"]),
                organization: str_at(&account, &["organizationName"]),
                plan,
            }
        }
        Engine::Codex => {
            let auth = read_json(&home.join("auth.json")).unwrap_or(Value::Null);
            let api_key = auth
                .get("OPENAI_API_KEY")
                .and_then(Value::as_str)
                .is_some_and(|k| !k.is_empty());
            let claims = auth
                .get("tokens")
                .and_then(|t| t.get("id_token"))
                .and_then(Value::as_str)
                .and_then(jwt_claims)
                .unwrap_or(Value::Null);
            let plan = str_at(
                &claims,
                &["https://api.openai.com/auth", "chatgpt_plan_type"],
            )
            .map(|p| {
                let mut c = p.chars();
                c.next()
                    .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                    .unwrap_or(p)
            });
            Identity {
                signed_in: api_key || !claims.is_null(),
                email: str_at(&claims, &["email"]),
                name: str_at(&claims, &["name"]),
                organization: None,
                plan: plan.or(if api_key {
                    Some("API key".into())
                } else {
                    None
                }),
            }
        }
        Engine::Gemini => {
            let dir = home.join(".gemini");
            if uses_api_key(Engine::Gemini, home) {
                return Identity {
                    signed_in: true,
                    plan: Some("API key".into()),
                    ..Identity::default()
                };
            }
            let accounts = read_json(&dir.join("google_accounts.json")).unwrap_or(Value::Null);
            Identity {
                signed_in: dir.join("oauth_creds.json").is_file(),
                email: str_at(&accounts, &["active"]),
                name: None,
                organization: None,
                plan: Some("Google account".into()),
            }
        }
    }
}

// ─── Views ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    id: String,
    label: String,
    is_default: bool,
    home: String,
    /// Runs on an API key rather than a subscription sign-in.
    api_key: bool,
    #[serde(flatten)]
    identity: Identity,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineView {
    engine: &'static str,
    label: &'static str,
    cli: &'static str,
    cli_installed: bool,
    active: String,
    accounts: Vec<AccountView>,
}

fn cli_installed(cli: &str) -> bool {
    let finder = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(finder);
    cmd.arg(cli);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn engine_view(app: &AppHandle, registry: &Registry, engine: Engine) -> EngineView {
    let entry = registry
        .engines
        .get(engine.key())
        .cloned()
        .unwrap_or_default();
    let default_home = engine.default_home();
    let mut accounts = vec![AccountView {
        id: "default".into(),
        label: "This computer".into(),
        is_default: true,
        home: default_home.to_string_lossy().into_owned(),
        api_key: false,
        identity: identity(engine, &default_home, true),
    }];
    for profile in &entry.profiles {
        if let Ok(dir) = profile_dir(app, engine, &profile.id) {
            accounts.push(AccountView {
                id: profile.id.clone(),
                label: profile.label.clone(),
                is_default: false,
                home: dir.to_string_lossy().into_owned(),
                api_key: uses_api_key(engine, &dir),
                identity: identity(engine, &dir, false),
            });
        }
    }
    EngineView {
        engine: engine.key(),
        label: engine.label(),
        cli: engine.cli(),
        cli_installed: cli_installed(engine.cli()),
        active: entry.active.unwrap_or_else(|| "default".into()),
        accounts,
    }
}

// ─── Setting up an account's home, and signing in ────────────────────────────

/// Link a folder of the CLI's normal home into an account's home, so the
/// account keeps the user's skills, agents and plugins.
fn link_dir(src: &Path, dst: &Path) {
    if !src.is_dir() || dst.exists() {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dst)
            .arg(src)
            .creation_flags(0x0800_0000)
            .output();
    }
    #[cfg(unix)]
    {
        let _ = std::os::unix::fs::symlink(src, dst);
    }
}

fn seed_home(engine: Engine, dir: &Path) {
    let normal = engine.default_home();
    match engine {
        Engine::Claude => {
            for name in ["skills", "agents", "commands", "plugins", "output-styles"] {
                link_dir(&normal.join(name), &dir.join(name));
            }
            if let Ok(settings) = std::fs::read(normal.join("settings.json")) {
                let _ = std::fs::write(dir.join("settings.json"), settings);
            }
        }
        Engine::Codex => {
            if let Ok(config) = std::fs::read(normal.join("config.toml")) {
                let _ = std::fs::write(dir.join("config.toml"), config);
            }
            link_dir(&normal.join("packages"), &dir.join("packages"));
        }
        Engine::Gemini => {
            let gemini = dir.join(".gemini");
            let _ = std::fs::create_dir_all(&gemini);
            if let Ok(settings) = std::fs::read(normal.join(".gemini").join("settings.json")) {
                let _ = std::fs::write(gemini.join("settings.json"), settings);
            }
        }
    }
}

/// Open a terminal running the CLI's login, with the account's home set (or
/// the CLI's normal home for "This computer").
fn open_login_terminal(engine: Engine, home: Option<&Path>, label: &str) -> Result<(), String> {
    let command = engine.login_command();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let title = format!("Sign in to {} ({label})", engine.label());
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", &title, "cmd", "/K", command])
            .creation_flags(0x0800_0000);
        if let Some(home) = home {
            cmd.env(engine.home_var(), home);
        }
        cmd.spawn()
            .map_err(|e| format!("Couldn't open a terminal: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = label;
        let line = match home {
            Some(home) => format!(
                "export {}='{}'; {command}",
                engine.home_var(),
                home.to_string_lossy().replace('\'', "'\\''")
            ),
            None => command.to_string(),
        };
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            line.replace('\\', "\\\\").replace('"', "\\\"")
        );
        Command::new("osascript")
            .args([
                "-e",
                &script,
                "-e",
                "tell application \"Terminal\" to activate",
            ])
            .spawn()
            .map_err(|e| format!("Couldn't open Terminal: {e}"))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = label;
        let mut cmd = Command::new("x-terminal-emulator");
        cmd.args(["-e", "sh", "-c", &format!("{command}; exec $SHELL")]);
        if let Some(home) = home {
            cmd.env(engine.home_var(), home);
        }
        cmd.spawn()
            .map_err(|e| format!("Couldn't open a terminal: {e}"))?;
        Ok(())
    }
}

/// Move a folder to the Recycle Bin / Trash rather than deleting it.
pub(crate) fn move_to_trash(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let path = dir.to_string_lossy().replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; \
             [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('{path}', 'OnlyErrorDialogs', 'SendToRecycleBin')"
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|e| format!("Couldn't move it to the Recycle Bin: {e}"))?;
        if !output.status.success() || dir.exists() {
            return Err("Couldn't move the account's folder to the Recycle Bin.".into());
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Finder\" to delete POSIX file \"{}\"",
            dir.to_string_lossy().replace('"', "\\\"")
        );
        let ok = Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            Ok(())
        } else {
            Err("Couldn't move the account's folder to the Trash.".into())
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let ok = Command::new("gio")
            .arg("trash")
            .arg(dir)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            Ok(())
        } else {
            Err("Couldn't move the account's folder to the Trash.".into())
        }
    }
}

// ─── Usage from the CLIs' own logs ───────────────────────────────────────────

#[derive(Default, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct Window {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    requests: u64,
}

impl Window {
    fn add(&mut self, input: u64, output: u64, cache_read: u64, cache_write: u64) {
        self.input += input;
        self.output += output;
        self.cache_read += cache_read;
        self.cache_write += cache_write;
        self.requests += 1;
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Limit {
    label: String,
    used_percent: f64,
    window_minutes: Option<u64>,
    resets_at: Option<i64>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    last5h: Window,
    today: Window,
    week: Window,
    limits: Vec<Limit>,
    plan: Option<String>,
    limits_at: Option<i64>,
    note: Option<String>,
}

struct Windows {
    now: i64,
    today_start: i64,
}

impl Windows {
    fn new() -> Windows {
        let now = now_ms();
        let local = chrono::Local::now();
        let today_start = local
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .and_then(|t| t.and_local_timezone(chrono::Local).single())
            .map(|t| t.timestamp_millis())
            .unwrap_or(now - 86_400_000);
        Windows { now, today_start }
    }
    fn add(
        &self,
        usage: &mut Usage,
        at: i64,
        input: u64,
        output: u64,
        cache_read: u64,
        cache_write: u64,
    ) {
        if at > self.now - 7 * 86_400_000 {
            usage.week.add(input, output, cache_read, cache_write);
        }
        if at >= self.today_start {
            usage.today.add(input, output, cache_read, cache_write);
        }
        if at > self.now - 5 * 3_600_000 {
            usage.last5h.add(input, output, cache_read, cache_write);
        }
    }
}

const SCAN_DAYS: u64 = 8;

/// `*.jsonl` / `*.json` files under `dir` changed within the scan window.
fn recent_files(dir: &Path, extension: &str, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now() - Duration::from_secs(SCAN_DAYS * 86_400);
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            recent_files(&path, extension, out, depth + 1);
        } else if path.extension().and_then(|e| e.to_str()) == Some(extension)
            && meta.modified().map(|m| m >= cutoff).unwrap_or(false)
        {
            out.push(path);
        }
    }
}

fn parse_ts(value: Option<&Value>) -> Option<i64> {
    let text = value?.as_str()?;
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|t| t.timestamp_millis())
}

fn num(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn claude_usage(home: &Path) -> Usage {
    let windows = Windows::new();
    let mut usage = Usage::default();
    let mut files = Vec::new();
    recent_files(&home.join("projects"), "jsonl", &mut files, 0);
    let mut seen = HashSet::new();
    for file in files {
        let Ok(handle) = std::fs::File::open(&file) else {
            continue;
        };
        for line in BufReader::new(handle).lines().map_while(Result::ok) {
            if !line.contains("\"usage\"") {
                continue;
            }
            let Ok(record) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(message) = record.get("message") else {
                continue;
            };
            let Some(u) = message.get("usage") else {
                continue;
            };
            // Claude Code logs one line per content block with the same usage.
            let key = format!(
                "{}:{}",
                message.get("id").and_then(Value::as_str).unwrap_or(""),
                record
                    .get("requestId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            );
            if key != ":" && !seen.insert(key) {
                continue;
            }
            let Some(at) = parse_ts(record.get("timestamp")) else {
                continue;
            };
            windows.add(
                &mut usage,
                at,
                num(u, "input_tokens"),
                num(u, "output_tokens"),
                num(u, "cache_read_input_tokens"),
                num(u, "cache_creation_input_tokens"),
            );
        }
    }
    usage.note = Some(
        "Claude doesn't share plan limits with other apps; run /usage in Claude Code for the exact percentages.".into(),
    );
    usage
}

fn account_at(history: &[Switch], at: i64) -> Option<String> {
    history
        .iter()
        .filter(|s| s.at <= at)
        .max_by_key(|s| s.at)
        .and_then(|s| s.id.clone())
}

fn codex_limit(value: &Value, fallback: &str) -> Option<Limit> {
    let used = value.get("used_percent").and_then(Value::as_f64)?;
    let window = value.get("window_minutes").and_then(Value::as_u64);
    let label = match window {
        Some(300) => "5-hour limit".to_string(),
        Some(10_080) => "Weekly limit".to_string(),
        Some(m) if m % 1_440 == 0 => format!("{}-day limit", m / 1_440),
        Some(m) if m % 60 == 0 => format!("{}-hour limit", m / 60),
        _ => fallback.to_string(),
    };
    Some(Limit {
        label,
        used_percent: used,
        window_minutes: window,
        resets_at: value.get("resets_at").and_then(Value::as_i64),
    })
}

fn codex_usage(home: &Path, account: Option<&str>, history: &[Switch]) -> Usage {
    let windows = Windows::new();
    let mut usage = Usage::default();
    let user_sessions = Engine::Codex.default_home().join("sessions");
    let agents_sessions = user_sessions.join("munder-difflin");
    let mut files = Vec::new();
    recent_files(&home.join("sessions"), "jsonl", &mut files, 0);
    if account.is_some() {
        // Agents' sessions live under the user's own Codex home.
        recent_files(&agents_sessions, "jsonl", &mut files, 0);
    }
    let mut latest: Option<(i64, Value)> = None;
    for file in files {
        let shared = file.starts_with(&agents_sessions);
        let Ok(handle) = std::fs::File::open(&file) else {
            continue;
        };
        for line in BufReader::new(handle).lines().map_while(Result::ok) {
            if !line.contains("\"token_count\"") {
                continue;
            }
            let Ok(record) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(payload) = record.get("payload") else {
                continue;
            };
            if payload.get("type").and_then(Value::as_str) != Some("token_count") {
                continue;
            }
            let Some(at) = parse_ts(record.get("timestamp")) else {
                continue;
            };
            if shared && account_at(history, at).as_deref() != account {
                continue;
            }
            if let Some(last) = payload.get("info").and_then(|i| i.get("last_token_usage")) {
                let input = num(last, "input_tokens");
                let cached = num(last, "cached_input_tokens");
                windows.add(
                    &mut usage,
                    at,
                    input.saturating_sub(cached),
                    num(last, "output_tokens"),
                    cached,
                    num(last, "cache_write_input_tokens"),
                );
            }
            if let Some(limits) = payload.get("rate_limits").filter(|l| !l.is_null()) {
                if latest.as_ref().map(|(t, _)| at > *t).unwrap_or(true) {
                    latest = Some((at, limits.clone()));
                }
            }
        }
    }
    if let Some((at, limits)) = latest {
        usage.limits_at = Some(at);
        usage.plan = str_at(&limits, &["plan_type"]).map(|p| {
            let mut c = p.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or(p)
        });
        for (key, fallback) in [("primary", "Usage limit"), ("secondary", "Second limit")] {
            if let Some(limit) = limits.get(key).and_then(|v| codex_limit(v, fallback)) {
                usage.limits.push(limit);
            }
        }
    } else {
        usage.note = Some(
            "No limit reading yet: it arrives with the next Codex reply on this account.".into(),
        );
    }
    usage
}

fn gemini_usage(home: &Path) -> Usage {
    let windows = Windows::new();
    let mut usage = Usage::default();
    let mut files = Vec::new();
    recent_files(&home.join(".gemini").join("tmp"), "json", &mut files, 0);
    for file in files {
        if !file.to_string_lossy().contains("chats") {
            continue;
        }
        let Some(doc) = read_json(&file) else {
            continue;
        };
        for message in doc
            .get("messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(tokens) = message.get("tokens") else {
                continue;
            };
            let Some(at) = parse_ts(message.get("timestamp")) else {
                continue;
            };
            let cached = num(tokens, "cached");
            windows.add(
                &mut usage,
                at,
                num(tokens, "input").saturating_sub(cached),
                num(tokens, "output") + num(tokens, "thoughts"),
                cached,
                0,
            );
        }
    }
    usage.note = Some("Google doesn't share plan limits with other apps; counts come from Gemini CLI's chat logs.".into());
    usage
}

// ─── API keys ────────────────────────────────────────────────────────────────
//
// An account can run on an API key instead of a subscription sign-in. The key
// goes where each CLI looks for it in its own home, never into an environment
// variable (so agents' shells don't inherit it):
// - Claude Code: an `apiKeyHelper` in the home's settings.json, a tiny script
//   that prints the key from a file next to it;
// - Codex: `codex login --with-api-key`, which writes the home's auth.json;
// - Gemini CLI: GEMINI_API_KEY in the home's `.gemini/.env`.

const CLAUDE_KEY_FILE: &str = "api-key";

fn helper_name() -> &'static str {
    if cfg!(windows) {
        "api-key.cmd"
    } else {
        "api-key.sh"
    }
}

fn check_api_key(key: &str) -> Result<String, String> {
    let key = key.trim();
    if key.len() < 20 || key.len() > 512 {
        return Err("That doesn't look like an API key.".into());
    }
    if !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err("An API key has no spaces or line breaks.".into());
    }
    Ok(key.to_string())
}

/// Write a file only the owner can read (on Unix; Windows keeps the user
/// profile's own permissions).
fn write_private(path: &Path, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn merge_json(path: &Path, apply: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Result<(), String> {
    let mut value = read_json(path).unwrap_or_else(|| Value::Object(Default::default()));
    if !value.is_object() {
        value = Value::Object(Default::default());
    }
    if let Some(map) = value.as_object_mut() {
        apply(map);
    }
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    write_atomic(path, &text)
}

fn install_api_key(engine: Engine, dir: &Path, key: &str) -> Result<(), String> {
    let key = check_api_key(key)?;
    match engine {
        Engine::Claude => {
            write_private(&dir.join(CLAUDE_KEY_FILE), &key)?;
            let helper = dir.join(helper_name());
            if cfg!(windows) {
                write_private(&helper, "@type \"%~dp0api-key\"\r\n")?;
            } else {
                write_private(&helper, "#!/bin/sh\ncat \"$(dirname \"$0\")/api-key\"\n")?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700));
                }
            }
            let command = if cfg!(windows) {
                format!("\"{}\"", helper.display())
            } else {
                format!("'{}'", helper.to_string_lossy().replace('\'', "'\\''"))
            };
            merge_json(&dir.join("settings.json"), |settings| {
                settings.insert("apiKeyHelper".into(), Value::String(command));
            })?;
            // Skip the first-run sign-in screens; the key is the sign-in.
            merge_json(&dir.join(".claude.json"), |state| {
                state.insert("hasCompletedOnboarding".into(), Value::Bool(true));
            })
        }
        Engine::Codex => {
            use std::io::Write;
            let mut cmd = if cfg!(windows) {
                let mut c = Command::new("cmd");
                c.args(["/C", "codex", "login", "--with-api-key"]);
                c
            } else {
                let mut c = Command::new("codex");
                c.args(["login", "--with-api-key"]);
                c
            };
            cmd.env("CODEX_HOME", dir)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            let mut child = cmd.spawn().map_err(|e| format!("Couldn't run codex: {e}"))?;
            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(format!("{key}\n").as_bytes())
                    .map_err(|e| format!("Couldn't give codex the key: {e}"))?;
            }
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                let reason = String::from_utf8_lossy(&output.stderr)
                    .lines()
                    .last()
                    .unwrap_or("")
                    .replace(&key, "…")
                    .trim()
                    .to_string();
                return Err(if reason.is_empty() {
                    "Codex didn't accept the key.".into()
                } else {
                    format!("Codex didn't accept the key: {reason}")
                });
            }
            Ok(())
        }
        Engine::Gemini => {
            let gemini = dir.join(".gemini");
            std::fs::create_dir_all(&gemini).map_err(|e| e.to_string())?;
            write_private(&gemini.join(".env"), &format!("GEMINI_API_KEY={key}\n"))?;
            merge_json(&gemini.join("settings.json"), |settings| {
                settings.insert("selectedAuthType".into(), Value::String("gemini-api-key".into()));
                let security = settings
                    .entry("security")
                    .or_insert_with(|| Value::Object(Default::default()));
                if let Some(security) = security.as_object_mut() {
                    let auth = security
                        .entry("auth")
                        .or_insert_with(|| Value::Object(Default::default()));
                    if let Some(auth) = auth.as_object_mut() {
                        auth.insert("selectedType".into(), Value::String("gemini-api-key".into()));
                    }
                }
            })
        }
    }
}

/// Whether an account's home runs on an API key Buzz installed.
fn uses_api_key(engine: Engine, home: &Path) -> bool {
    match engine {
        Engine::Claude => {
            home.join(CLAUDE_KEY_FILE).is_file()
                && read_json(&home.join("settings.json"))
                    .and_then(|s| s.get("apiKeyHelper").cloned())
                    .is_some()
        }
        Engine::Codex => read_json(&home.join("auth.json"))
            .and_then(|a| a.get("OPENAI_API_KEY").and_then(Value::as_str).map(|k| !k.is_empty()))
            .unwrap_or(false),
        Engine::Gemini => std::fs::read_to_string(home.join(".gemini").join(".env"))
            .map(|t| t.lines().any(|l| l.trim_start().starts_with("GEMINI_API_KEY=")))
            .unwrap_or(false),
    }
}

/// Add an account that runs on an API key (no sign-in).
#[tauri::command]
pub fn ai_accounts_add_api_key(
    app: AppHandle,
    engine: String,
    label: String,
    key: String,
) -> Result<String, String> {
    let engine = Engine::parse(&engine)?;
    check_api_key(&key)?;
    let label = label.trim();
    let label = if label.is_empty() { "API key" } else { label };
    let id = format!("acct-{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    let dir = profile_dir(&app, engine, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    seed_home(engine, &dir);
    if let Err(error) = install_api_key(engine, &dir, &key) {
        let _ = move_to_trash(&dir);
        return Err(error);
    }
    let mut registry = load_registry(&app);
    registry
        .engines
        .entry(engine.key().into())
        .or_default()
        .profiles
        .push(Profile {
            id: id.clone(),
            label: label.to_string(),
            created_at: now_ms(),
        });
    save_registry(&app, &registry)?;
    Ok(id)
}

/// Replace the API key of an account Buzz added.
#[tauri::command]
pub fn ai_accounts_set_api_key(
    app: AppHandle,
    engine: String,
    id: String,
    key: String,
) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    if id == "default" {
        return Err("This computer's own sign-in isn't changed here; add an API key account instead.".into());
    }
    let dir = profile_dir(&app, engine, &id)?;
    if !dir.is_dir() {
        return Err("That account isn't there anymore.".into());
    }
    install_api_key(engine, &dir, &key)
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ai_accounts_list(app: AppHandle) -> Result<Vec<EngineView>, String> {
    tokio::task::spawn_blocking(move || {
        let registry = load_registry(&app);
        ENGINES
            .iter()
            .map(|e| engine_view(&app, &registry, *e))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Add an account: make its home and open its CLI's sign-in.
#[tauri::command]
pub fn ai_accounts_add(app: AppHandle, engine: String, label: String) -> Result<String, String> {
    let engine = Engine::parse(&engine)?;
    let label = label.trim();
    let label = if label.is_empty() {
        "New account"
    } else {
        label
    };
    let id = format!("acct-{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    let dir = profile_dir(&app, engine, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    seed_home(engine, &dir);
    let mut registry = load_registry(&app);
    registry
        .engines
        .entry(engine.key().into())
        .or_default()
        .profiles
        .push(Profile {
            id: id.clone(),
            label: label.to_string(),
            created_at: now_ms(),
        });
    save_registry(&app, &registry)?;
    open_login_terminal(engine, Some(&dir), label)?;
    Ok(id)
}

/// Sign in (again) to an account in a terminal.
#[tauri::command]
pub fn ai_accounts_sign_in(app: AppHandle, engine: String, id: String) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    if id == "default" {
        return open_login_terminal(engine, None, "This computer");
    }
    let dir = profile_dir(&app, engine, &id)?;
    open_login_terminal(engine, Some(&dir), &id)
}

/// Agents of this engine use the account from their next (re)start.
#[tauri::command]
pub fn ai_accounts_set_active(app: AppHandle, engine: String, id: String) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    let mut registry = load_registry(&app);
    let next = if id == "default" {
        None
    } else {
        Some(id.clone())
    };
    if let Some(id) = &next {
        let dir = profile_dir(&app, engine, id)?;
        if !identity(engine, &dir, false).signed_in {
            return Err("Sign in to that account first.".into());
        }
    }
    let entry = registry.engines.entry(engine.key().into()).or_default();
    if let Some(id) = &next {
        if !entry.profiles.iter().any(|p| &p.id == id) {
            return Err("No such account.".into());
        }
    }
    if entry.active != next {
        entry.active = next.clone();
        entry.history.push(Switch {
            at: now_ms(),
            id: next,
        });
        if entry.history.len() > 200 {
            entry.history.drain(..entry.history.len() - 200);
        }
    }
    save_registry(&app, &registry)
}

#[tauri::command]
pub fn ai_accounts_rename(
    app: AppHandle,
    engine: String,
    id: String,
    label: String,
) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    let mut registry = load_registry(&app);
    let entry = registry.engines.entry(engine.key().into()).or_default();
    let profile = entry
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("No such account.")?;
    let label = label.trim();
    if label.is_empty() {
        return Err("Give the account a name.".into());
    }
    profile.label = label.to_string();
    save_registry(&app, &registry)
}

/// Remove an account; its folder (and sign-in) goes to the Recycle Bin.
#[tauri::command]
pub fn ai_accounts_remove(app: AppHandle, engine: String, id: String) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    if id == "default" {
        return Err("This computer's own sign-in can't be removed here.".into());
    }
    let dir = profile_dir(&app, engine, &id)?;
    move_to_trash(&dir)?;
    let mut registry = load_registry(&app);
    let entry = registry.engines.entry(engine.key().into()).or_default();
    entry.profiles.retain(|p| p.id != id);
    if entry.active.as_deref() == Some(id.as_str()) {
        entry.active = None;
        entry.history.push(Switch {
            at: now_ms(),
            id: None,
        });
    }
    save_registry(&app, &registry)
}

#[tauri::command]
pub async fn ai_accounts_usage(
    app: AppHandle,
    engine: String,
    id: String,
) -> Result<Usage, String> {
    let engine = Engine::parse(&engine)?;
    let registry = load_registry(&app);
    let history = registry
        .engines
        .get(engine.key())
        .map(|e| e.history.clone())
        .unwrap_or_default();
    let (home, account) = if id == "default" {
        (engine.default_home(), None)
    } else {
        (profile_dir(&app, engine, &id)?, Some(id))
    };
    tokio::task::spawn_blocking(move || match engine {
        Engine::Claude => claude_usage(&home),
        Engine::Codex => codex_usage(&home, account.as_deref(), &history),
        Engine::Gemini => gemini_usage(&home),
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn attributes_by_the_account_active_at_the_time() {
        let history = vec![
            Switch {
                at: 100,
                id: Some("a".into()),
            },
            Switch { at: 200, id: None },
        ];
        assert_eq!(account_at(&history, 50), None);
        assert_eq!(account_at(&history, 150).as_deref(), Some("a"));
        assert_eq!(account_at(&history, 250), None);
    }

    #[test]
    fn reads_jwt_claims_without_verifying() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(json!({ "email": "a@b.c" }).to_string());
        assert_eq!(
            jwt_claims(&format!("x.{payload}.y")).and_then(|c| str_at(&c, &["email"])),
            Some("a@b.c".into())
        );
    }

    #[test]
    fn labels_codex_limits_by_window() {
        let limit = codex_limit(
            &json!({ "used_percent": 15.0, "window_minutes": 10080 }),
            "x",
        )
        .unwrap();
        assert_eq!(limit.label, "Weekly limit");
        let limit =
            codex_limit(&json!({ "used_percent": 3.0, "window_minutes": 300 }), "x").unwrap();
        assert_eq!(limit.label, "5-hour limit");
    }
}
