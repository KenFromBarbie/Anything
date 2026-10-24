//! Drafting a new server's setup from what it's for. Claude (the account
//! picked in Settings → AI accounts) reads the name, the description, any
//! attached files and links, and proposes the permanent staff, channels
//! specific to the work, starter threads and a brief for Michael. The app
//! shows that draft for editing before anything is created.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const PLAN_MODEL: &str = "claude-sonnet-5-5";
const PLAN_TIMEOUT: Duration = Duration::from_secs(180);
/// How much of each attached text file goes into the planning prompt.
const FILE_EXCERPT_BYTES: usize = 20_000;
/// Names with a look on the floor (the Office's cast); Michael is taken.
const CAST: &[&str] = &[
    "Jim", "Pam", "Dwight", "Kevin", "Angela", "Oscar", "Stanley", "Phyllis", "Andy", "Kelly",
    "Ryan", "Toby", "Creed", "Meredith",
];

fn claude_bin() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let exe = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    let local = home.join(".local").join("bin").join(exe);
    if local.is_file() {
        local
    } else {
        PathBuf::from("claude")
    }
}

/// The picked Claude account's home, if one is picked.
fn claude_home(app: &AppHandle) -> Option<PathBuf> {
    let file = crate::ai_accounts::active_file(app)?;
    let active: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    let home = PathBuf::from(active.get("claude")?.as_str()?);
    home.is_dir().then_some(home)
}

/// A text excerpt of an attached file, or a note that it isn't text.
fn excerpt(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let Ok(mut file) = std::fs::File::open(path) else {
        return format!("--- {name} (could not be opened)");
    };
    let mut bytes = Vec::new();
    let _ = (&mut file)
        .take(FILE_EXCERPT_BYTES as u64 + 1)
        .read_to_end(&mut bytes);
    if bytes.contains(&0) {
        return format!("--- {name} (not a text file; the agents will open it themselves)");
    }
    let cut = bytes.len() > FILE_EXCERPT_BYTES;
    bytes.truncate(FILE_EXCERPT_BYTES);
    let text = String::from_utf8_lossy(&bytes);
    format!(
        "--- {name}{}\n{text}",
        if cut { " (first part)" } else { "" }
    )
}

fn planning_prompt(name: &str, purpose: &str, files: &[String], links: &[String]) -> String {
    let mut out = format!(
        "You are setting up a new AI-run office (a \"server\") for its owner.\n\n\
Server name: {name}\nWhat the work is: {purpose}\n"
    );
    if !links.is_empty() {
        out.push_str(
            "\nLinks the owner attached (read them if they help you understand the work):\n",
        );
        for link in links {
            out.push_str(&format!("- {link}\n"));
        }
    }
    if !files.is_empty() {
        out.push_str("\nFiles the owner attached:\n");
        for file in files {
            out.push_str(&excerpt(Path::new(file)));
            out.push('\n');
        }
    }
    out.push_str(&format!(
        "\nHow the office works: Michael runs it. Under him sit PERMANENT STAFF: a few \
standing roles that live in their own offices for as long as the server exists and \
each own one area of the work (for example a programme manager, IT support, HR, \
finance, a lead researcher: whatever THIS work actually needs, never generic). \
Michael splits every request between the staff; each staff member breaks their \
part into tasks and hires short-lived floor workers to do them, then checks and \
returns the results.\n\n\
Propose the setup for THIS work. Be specific to it: names of channels and roles \
must make sense only for this server, not for any project.\n\
- staff: 2 to 4 permanent roles. Give each a first name from this list (each once): \
{}. The role is \"Title: what they own and decide\" in at most 15 words.\n\
- channels: 4 to 7 channels named in lower-case-with-dashes after the actual \
workstreams, deliverables or audiences of this work, each with a one-line purpose.\n\
- threads: 2 to 4 first posts that start the real work, each in one of your channels.\n\
- brief: 3 to 6 sentences for Michael: the mission, who it serves, what good \
looks like, and the first goals, using what the files and links say.\n\n\
Reply with ONLY this JSON, nothing before or after it:\n\
{{\"staff\":[{{\"name\":\"\",\"role\":\"\"}}],\"channels\":[{{\"name\":\"\",\"purpose\":\"\"}}],\
\"threads\":[{{\"channel\":\"\",\"title\":\"\"}}],\"brief\":\"\"}}\n",
        CAST.join(", ")
    ));
    out
}

/// Claude's answer from its JSON result, or its own reason when it failed
/// (signed out, out of credits, unknown model...), so the owner sees why.
fn reply_text(output: &str) -> Result<String, String> {
    let Ok(result) = serde_json::from_str::<Value>(output.trim()) else {
        // An older CLI, or plain text: use it as the answer.
        return Ok(output.to_string());
    };
    let text = result
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if result.get("is_error").and_then(Value::as_bool) == Some(true) {
        let why = if text.is_empty() {
            result
                .get("terminal_reason")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_string()
        } else {
            text.chars().take(200).collect()
        };
        return Err(format!(
            "Claude said: {why}. Check the account in Settings → AI accounts"
        ));
    }
    Ok(text)
}

/// The JSON object in Claude's reply (it may wrap it in a code fence).
fn parse_plan(reply: &str) -> Result<Value, String> {
    let start = reply.find('{').ok_or("the planner gave no plan")?;
    let end = reply.rfind('}').ok_or("the planner gave no plan")?;
    let plan: Value = serde_json::from_str(&reply[start..=end])
        .map_err(|e| format!("the planner's plan was unreadable: {e}"))?;
    for key in ["staff", "channels", "threads"] {
        if !plan.get(key).is_some_and(Value::is_array) {
            return Err(format!("the planner's plan had no {key}"));
        }
    }
    Ok(plan)
}

fn run_planner(app: &AppHandle, prompt: &str, browse: bool) -> Result<String, String> {
    let mut command = Command::new(claude_bin());
    command
        .args([
            "-p",
            "--model",
            PLAN_MODEL,
            "--output-format",
            "json",
            "--no-session-persistence",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
        ])
        // Links are read with WebFetch; nothing else is allowed (a -p run
        // refuses any tool it isn't granted).
        .args(if browse {
            vec!["--allowedTools", "WebFetch"]
        } else {
            vec![]
        })
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for secret in ["BUZZ_PRIVATE_KEY", "BUZZ_AUTH_TAG", "NOSTR_PRIVATE_KEY"] {
        command.env_remove(secret);
    }
    if let Some(home) = claude_home(app) {
        command.env("CLAUDE_CONFIG_DIR", home);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start Claude to draft the setup: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("could not brief Claude: {e}"))?;
    }
    let mut stdout = child.stdout.take().ok_or("no output from Claude")?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let out = reader.join().unwrap_or_default();
            if !status.success() && out.trim().is_empty() {
                let mut err = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = stderr.read_to_string(&mut err);
                }
                return Err(format!(
                    "Claude could not draft the setup: {}",
                    err.trim().chars().take(300).collect::<String>()
                ));
            }
            return Ok(out);
        }
        if started.elapsed() > PLAN_TIMEOUT {
            let _ = child.kill();
            return Err("drafting the setup took too long".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Draft the setup for a new server: `{ staff, channels, threads, brief }`.
#[tauri::command]
pub async fn server_plan(
    app: AppHandle,
    name: String,
    purpose: String,
    files: Vec<String>,
    links: Vec<String>,
) -> Result<Value, String> {
    let prompt = planning_prompt(name.trim(), purpose.trim(), &files, &links);
    let browse = !links.is_empty();
    tauri::async_runtime::spawn_blocking(move || {
        parse_plan(&reply_text(&run_planner(&app, &prompt, browse)?)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pick files to hand to a new server's agents.
#[tauri::command]
pub async fn server_pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Files for the agents")
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|f| f.into_path().ok())
            .map(|p| p.display().to_string())
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Copy the attached files into the server's work folder (`inputs/`), so the
/// agents, who work there, have them. Returns the copies' paths.
#[tauri::command]
pub fn server_attach_files(work_folder: String, files: Vec<String>) -> Result<Vec<String>, String> {
    let inputs = Path::new(&work_folder).join("inputs");
    std::fs::create_dir_all(&inputs)
        .map_err(|e| format!("could not make {}: {e}", inputs.display()))?;
    let mut copied = Vec::new();
    for file in files {
        let from = Path::new(&file);
        let Some(name) = from.file_name() else {
            continue;
        };
        let to = inputs.join(name);
        std::fs::copy(from, &to).map_err(|e| format!("could not copy {}: {e}", from.display()))?;
        copied.push(to.display().to_string());
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_plan_wrapped_in_a_code_fence() {
        let reply = "```json\n{\"staff\":[{\"name\":\"Pam\",\"role\":\"Registrar: enrolment\"}],\"channels\":[],\"threads\":[],\"brief\":\"b\"}\n```";
        let plan = parse_plan(reply).unwrap();
        assert_eq!(plan["staff"][0]["name"], "Pam");
    }

    #[test]
    fn claude_failures_come_back_with_their_reason() {
        let failed = r#"{"is_error":true,"terminal_reason":"api_error","result":"Failed to authenticate: OAuth session expired"}"#;
        let err = reply_text(failed).unwrap_err();
        assert!(err.contains("OAuth session expired"), "{err}");
        let ok = r#"{"is_error":false,"result":"{\"staff\":[],\"channels\":[],\"threads\":[]}"}"#;
        assert!(parse_plan(&reply_text(ok).unwrap()).is_ok());
    }

    #[test]
    fn a_reply_without_a_plan_is_an_error() {
        assert!(parse_plan("I can't do that").is_err());
        assert!(parse_plan("{\"staff\":[]}").is_err());
    }

    #[test]
    fn the_prompt_carries_the_links_and_the_cast() {
        let prompt = planning_prompt(
            "w",
            "University assistant",
            &[],
            &["https://example.edu".into()],
        );
        assert!(prompt.contains("https://example.edu"));
        assert!(prompt.contains("Dwight"));
        assert!(!prompt.contains("Michael,"));
    }
}
