//! What the owner adds to the Studio (Research → Artifacts), per server:
//!
//! - **Workflows and apps** of their own, next to the built-in "make" tiles
//!   (`<hive>/shared/studio/workflows.json`). A workflow is instructions an
//!   agent follows each time it's used; an app is something an agent builds
//!   once and the tile then opens.
//! - **Codebases** the agents design and build against, like Claude Design's
//!   (`<hive>/shared/codebases/index.json`): a GitHub repo cloned into the
//!   hive, or a folder on this computer, linked where it is.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::office_desk::{hive_shared_dir, write_list};

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn read_list(path: &Path) -> Vec<Value> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Lowercase letters, digits and dashes, for folder names and ids.
fn slug(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "item".into() } else { out.chars().take(48).collect() }
}

// ─── Workflows and apps ─────────────────────────────────────────────────────

fn workflows_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(hive_shared_dir(app)
        .ok_or("the Office is not set up")?
        .join("studio")
        .join("workflows.json"))
}

/// The owner's own Studio tiles, oldest first.
#[tauri::command]
pub async fn studio_workflows(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(read_list(&workflows_path(&app)?))
}

/// Add a tile, or change one (by its id). Returns it as saved.
#[tauri::command]
pub async fn studio_workflow_save(app: AppHandle, workflow: Value) -> Result<Value, String> {
    let name = workflow["name"].as_str().unwrap_or("").trim().to_string();
    let instructions = workflow["instructions"].as_str().unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err("give it a name".into());
    }
    if instructions.is_empty() {
        return Err("say what the agent should do".into());
    }
    let kind = if workflow["kind"].as_str() == Some("app") { "app" } else { "workflow" };
    let path = workflows_path(&app)?;
    let mut list = read_list(&path);
    let id = workflow["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}-{:x}", slug(&name), now_ms()));
    let saved = json!({
        "id": id,
        "kind": kind,
        "name": name,
        "instructions": instructions,
        "icon": workflow["icon"].as_str().unwrap_or("sparkles"),
        "tone": workflow["tone"].as_str().unwrap_or("slate"),
        "createdAt": list
            .iter()
            .find(|w| w["id"].as_str() == Some(id.as_str()))
            .and_then(|w| w["createdAt"].as_u64())
            .unwrap_or_else(now_ms),
    });
    match list.iter_mut().find(|w| w["id"].as_str() == Some(id.as_str())) {
        Some(existing) => *existing = saved.clone(),
        None => list.push(saved.clone()),
    }
    std::fs::create_dir_all(path.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
    write_list(&path, &list)?;
    Ok(saved)
}

#[tauri::command]
pub async fn studio_workflow_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = workflows_path(&app)?;
    let mut list = read_list(&path);
    list.retain(|w| w["id"].as_str() != Some(id.as_str()));
    write_list(&path, &list)
}

// ─── Codebases ──────────────────────────────────────────────────────────────

fn codebases_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(hive_shared_dir(app).ok_or("the Office is not set up")?.join("codebases"))
}

/// `git`, without a console window flashing up on Windows, and never asking
/// for a password in a terminal no one sees.
fn git(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).env("GIT_TERMINAL_PROMPT", "0");
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "git isn't installed on this computer".to_string()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("git failed").trim().to_string())
    }
}

/// A GitHub repo as `(clone url, owner/name)`: `owner/name`, or its
/// github.com address (with or without `.git`, or a path after it).
fn github_repo(input: &str) -> Option<(String, String)> {
    let text = input.trim().trim_end_matches('/');
    let rest = text
        .strip_prefix("https://github.com/")
        .or_else(|| text.strip_prefix("http://github.com/"))
        .or_else(|| text.strip_prefix("github.com/"))
        .or_else(|| text.strip_prefix("git@github.com:"))
        .unwrap_or(text);
    let mut parts = rest.split('/');
    let owner = parts.next()?;
    let name = parts.next()?.trim_end_matches(".git");
    let valid = |s: &str| {
        !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    if !valid(owner) || !valid(name) || (rest == text && parts.next().is_some()) {
        return None;
    }
    Some((format!("https://github.com/{owner}/{name}.git"), format!("{owner}/{name}")))
}

/// The codebases as the page shows them: where each one is, whether it's a
/// git checkout, and the agents' design notes on it.
fn describe(dir: &Path, item: &Value) -> Value {
    let mut item = item.clone();
    let path = PathBuf::from(item["path"].as_str().unwrap_or(""));
    let id = item["id"].as_str().unwrap_or("").to_string();
    let notes = dir.join(format!("{id}.design.md"));
    item["exists"] = json!(path.is_dir());
    item["git"] = json!(path.join(".git").exists());
    if path.join(".git").exists() {
        item["branch"] = json!(git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&path)).ok());
    }
    item["notesPath"] = json!(notes.to_string_lossy());
    item["hasNotes"] = json!(notes.is_file());
    item
}

#[tauri::command]
pub async fn codebases(app: AppHandle) -> Result<Vec<Value>, String> {
    let dir = codebases_dir(&app)?;
    let list = read_list(&dir.join("index.json"));
    Ok(list.iter().map(|item| describe(&dir, item)).collect())
}

/// Link a codebase: a GitHub repo (cloned into the hive, so the agents can
/// read it and work in it) or a folder on this computer (used where it is).
#[tauri::command]
pub async fn codebase_add(app: AppHandle, source: String) -> Result<Value, String> {
    let dir = codebases_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let index = dir.join("index.json");
    let mut list = read_list(&index);
    let source = source.trim().to_string();
    let local = PathBuf::from(&source);
    let entry = if local.is_absolute() && local.is_dir() {
        let path = local.to_string_lossy().into_owned();
        if list.iter().any(|c| c["path"].as_str() == Some(path.as_str())) {
            return Err("that folder is already linked".into());
        }
        let name = local
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        json!({
            "id": format!("{}-{:x}", slug(&name), now_ms()),
            "name": name,
            "source": "local",
            "path": path,
            "addedAt": now_ms(),
        })
    } else {
        let (url, full_name) = github_repo(&source).ok_or(
            "that's not a GitHub repo (owner/name or its github.com address) or a folder on this computer",
        )?;
        if list.iter().any(|c| c["url"].as_str() == Some(url.as_str())) {
            return Err("that repo is already linked".into());
        }
        let id = slug(&full_name);
        let dest = dir.join(&id);
        if dest.exists() {
            return Err(format!("{} is in the way", dest.display()));
        }
        let dest_text = dest.to_string_lossy().into_owned();
        let clone_url = url.clone();
        tauri::async_runtime::spawn_blocking(move || {
            git(&["clone", "--depth", "1", &clone_url, &dest_text], None)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("couldn't clone it: {e}"))?;
        json!({
            "id": id,
            "name": full_name,
            "source": "github",
            "url": url,
            "path": dest.to_string_lossy(),
            "addedAt": now_ms(),
            "pulledAt": now_ms(),
        })
    };
    list.push(entry.clone());
    write_list(&index, &list)?;
    Ok(describe(&dir, &entry))
}

fn find_codebase(app: &AppHandle, id: &str) -> Result<(PathBuf, Vec<Value>, usize), String> {
    let dir = codebases_dir(app)?;
    let list = read_list(&dir.join("index.json"));
    let at = list
        .iter()
        .position(|c| c["id"].as_str() == Some(id))
        .ok_or("no such codebase")?;
    Ok((dir, list, at))
}

/// Bring a git checkout up to date (fast-forward only: never a merge).
#[tauri::command]
pub async fn codebase_pull(app: AppHandle, id: String) -> Result<Value, String> {
    let (dir, mut list, at) = find_codebase(&app, &id)?;
    let path = PathBuf::from(list[at]["path"].as_str().unwrap_or(""));
    if !path.join(".git").exists() {
        return Err("this folder isn't a git checkout".into());
    }
    let pull_in = path.clone();
    let said = tauri::async_runtime::spawn_blocking(move || git(&["pull", "--ff-only"], Some(&pull_in)))
        .await
        .map_err(|e| e.to_string())??;
    list[at]["pulledAt"] = json!(now_ms());
    write_list(&dir.join("index.json"), &list)?;
    Ok(json!({ "said": said, "codebase": describe(&dir, &list[at]) }))
}

#[tauri::command]
pub async fn codebase_open(app: AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let (_, list, at) = find_codebase(&app, &id)?;
    let path = list[at]["path"].as_str().unwrap_or("").to_string();
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Unlink a codebase. A clone the app made goes to the Recycle Bin; a folder
/// of the owner's own is left where it is.
#[tauri::command]
pub async fn codebase_remove(app: AppHandle, id: String) -> Result<(), String> {
    let (dir, mut list, at) = find_codebase(&app, &id)?;
    let item = list.remove(at);
    let path = PathBuf::from(item["path"].as_str().unwrap_or(""));
    if item["source"].as_str() == Some("github") && path.starts_with(&dir) && path.is_dir() {
        trash::delete(&path).map_err(|e| format!("couldn't move the clone to the Recycle Bin: {e}"))?;
    }
    let notes = dir.join(format!("{id}.design.md"));
    if notes.is_file() {
        let _ = trash::delete(&notes);
    }
    write_list(&dir.join("index.json"), &list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_github_repos() {
        let want = Some(("https://github.com/acme/site.git".to_string(), "acme/site".to_string()));
        assert_eq!(github_repo("acme/site"), want);
        assert_eq!(github_repo("https://github.com/acme/site"), want);
        assert_eq!(github_repo("https://github.com/acme/site.git"), want);
        assert_eq!(github_repo("github.com/acme/site/tree/main"), want);
        assert_eq!(github_repo("git@github.com:acme/site.git"), want);
        assert_eq!(github_repo("acme"), None);
        assert_eq!(github_repo("a/b/c"), None);
        assert_eq!(github_repo("https://gitlab.com/acme/site"), None);
        assert_eq!(github_repo("acme/si te"), None);
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Acme/Site"), "acme-site");
        assert_eq!(slug("  Weekly report!  "), "weekly-report");
        assert_eq!(slug("…"), "item");
    }
}
