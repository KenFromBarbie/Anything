//! A linked codebase's workspace (Research → Artifacts → Codebases → open
//! one): where it stands in git, its GitHub issues and pull requests, the
//! Office's memory of it, and a graphify knowledge graph of its code.
//!
//! - **Memory**: `<hive>/shared/codebases/<id>.memory.md`, a notebook the
//!   agents read before working in the codebase and add what they learn to;
//!   the owner can read and edit it too.
//! - **Graph**: `graphify update <path>` (AST only, no LLM, no keys), written
//!   to `<path>/graphify-out/` and kept out of git with `.git/info/exclude`.
//! - **GitHub**: read with the owner's `gh` (issues, pull requests). Nothing
//!   here writes to GitHub; agents only push or open PRs when the owner asks.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::office_desk::write_list;
use crate::studio_store::{find_codebase, git, github_repo};

/// A command-line tool, without a console window flashing up on Windows and
/// never stopping to ask anything.
fn run(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .env("PYTHONIOENCODING", "utf-8");
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
            format!("{program} isn't installed on this computer")
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("it failed")
            .trim()
            .to_string())
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn codebase(app: &AppHandle, id: &str) -> Result<(PathBuf, Value), String> {
    let (dir, list, at) = find_codebase(app, id)?;
    Ok((dir, list[at].clone()))
}

fn path_of(item: &Value) -> PathBuf {
    PathBuf::from(item["path"].as_str().unwrap_or(""))
}

pub(crate) fn memory_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.memory.md"))
}

pub(crate) fn graph_dir(path: &Path) -> PathBuf {
    path.join("graphify-out")
}

// ─── Git ────────────────────────────────────────────────────────────────────

/// `git status --porcelain=v1 -b`: the branch, its upstream, how far ahead
/// and behind it is, and the changed files.
fn parse_status(text: &str) -> Value {
    let mut lines = text.lines();
    let head = lines.next().unwrap_or("").trim_start_matches("## ");
    let (names, counts) = match head.find(" [") {
        Some(at) => (&head[..at], &head[at + 2..head.len().saturating_sub(1)]),
        None => (head, ""),
    };
    let (branch, upstream) = match names.split_once("...") {
        Some((b, u)) => (b.to_string(), Some(u.to_string())),
        None => (names.trim_start_matches("No commits yet on ").to_string(), None),
    };
    let mut ahead = 0;
    let mut behind = 0;
    for part in counts.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    let changed: Vec<Value> = lines
        .filter(|l| l.len() > 3)
        .map(|l| json!({ "status": l[..2].trim(), "path": l[3..].trim_matches('"') }))
        .collect();
    json!({
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "changedCount": changed.len(),
        "changed": changed.into_iter().take(60).collect::<Vec<_>>(),
    })
}

fn split_fields(text: &str, keys: &[&str]) -> Vec<Value> {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let mut row = serde_json::Map::new();
            for (key, value) in keys.iter().zip(line.split('\u{1f}')) {
                let value = match key.strip_suffix('#') {
                    Some(_) => json!(value.parse::<u64>().unwrap_or(0) * 1000),
                    None => json!(value),
                };
                row.insert(key.trim_end_matches('#').to_string(), value);
            }
            Value::Object(row)
        })
        .collect()
}

/// Where the codebase stands in git: branch, changes, recent commits and
/// branches. A folder that isn't a git checkout says so.
#[tauri::command]
pub async fn codebase_git(app: AppHandle, id: String) -> Result<Value, String> {
    let (_, item) = codebase(&app, &id)?;
    let path = path_of(&item);
    if !path.join(".git").exists() {
        return Ok(json!({ "git": false }));
    }
    blocking(move || {
        let mut out = parse_status(&git(&["status", "--porcelain=v1", "-b"], Some(&path))?);
        let commits = git(
            &["log", "-n", "20", "--pretty=format:%h%x1f%s%x1f%an%x1f%ct"],
            Some(&path),
        )
        .unwrap_or_default();
        out["commits"] = json!(split_fields(&commits, &["sha", "subject", "author", "at#"]));
        let branches = git(
            &[
                "branch",
                "--sort=-committerdate",
                "--format=%(refname:short)%1f%(committerdate:unix)%1f%(HEAD)",
            ],
            Some(&path),
        )
        .unwrap_or_default();
        let mut branches = split_fields(&branches, &["name", "at#", "head"]);
        branches.truncate(25);
        for b in &mut branches {
            b["current"] = json!(b["head"].as_str() == Some("*"));
        }
        out["branches"] = json!(branches);
        out["git"] = json!(true);
        Ok(out)
    })
    .await
}

// ─── GitHub ─────────────────────────────────────────────────────────────────

fn repo_slug(item: &Value, path: &Path) -> Option<String> {
    if let Some((_, slug)) = item["url"].as_str().and_then(github_repo) {
        return Some(slug);
    }
    let origin = git(&["remote", "get-url", "origin"], Some(path)).ok()?;
    github_repo(&origin).map(|(_, slug)| slug)
}

/// Open issues and pull requests on GitHub, read with the owner's `gh`.
#[tauri::command]
pub async fn codebase_github(app: AppHandle, id: String) -> Result<Value, String> {
    let (_, item) = codebase(&app, &id)?;
    let path = path_of(&item);
    blocking(move || {
        let repo = repo_slug(&item, &path).ok_or("it isn't on GitHub (no github.com origin)")?;
        let list = |kind: &str, fields: &str| -> Result<Value, String> {
            let text = run(
                "gh",
                &[kind, "list", "-R", &repo, "--state", "open", "--limit", "30", "--json", fields],
                None,
            )
            .map_err(|e| {
                if e.contains("auth login") || e.contains("not logged") {
                    "sign in to GitHub first: run `gh auth login` in a terminal".to_string()
                } else {
                    e
                }
            })?;
            serde_json::from_str(&text).map_err(|e| e.to_string())
        };
        let issues = list("issue", "number,title,labels,author,updatedAt,url,comments")?;
        let prs = list(
            "pr",
            "number,title,headRefName,author,isDraft,reviewDecision,updatedAt,url",
        )?;
        Ok(json!({ "repo": repo, "issues": issues, "prs": prs }))
    })
    .await
}

// ─── Memory ─────────────────────────────────────────────────────────────────

const MEMORY_TEMPLATE: &str = "# What the Office knows about this codebase\n\n\
Agents: read this before working here, and add what the next agent should know \
(how to build and test it, conventions, gotchas, decisions and why). Keep it short \
and current; correct what's wrong rather than appending contradictions.\n\n\
## Build and test\n\n## Layout\n\n## Conventions\n\n## Decisions\n\n## Gotchas\n";

#[tauri::command]
pub async fn codebase_memory(app: AppHandle, id: String) -> Result<Value, String> {
    let (dir, _) = codebase(&app, &id)?;
    let path = memory_path(&dir, &id);
    let text = std::fs::read_to_string(&path).ok();
    Ok(json!({
        "path": path.to_string_lossy(),
        "exists": text.is_some(),
        "text": text.unwrap_or_else(|| MEMORY_TEMPLATE.to_string()),
    }))
}

#[tauri::command]
pub async fn codebase_memory_save(app: AppHandle, id: String, text: String) -> Result<(), String> {
    let (dir, _) = codebase(&app, &id)?;
    if text.len() > 512 * 1024 {
        return Err("that's too long for a memory file (512 KB at most)".into());
    }
    std::fs::write(memory_path(&dir, &id), text).map_err(|e| e.to_string())
}

/// Make sure there's a memory file for the agents to read and add to.
pub(crate) fn ensure_memory(dir: &Path, id: &str) {
    let path = memory_path(dir, id);
    if !path.exists() {
        let _ = std::fs::write(path, MEMORY_TEMPLATE);
    }
}

// ─── Knowledge graph ────────────────────────────────────────────────────────

fn graph_info(path: &Path) -> Value {
    let out = graph_dir(path);
    let file = out.join("graph.json");
    let Ok(bytes) = std::fs::read(&file) else {
        return json!({ "built": false, "graphPath": file.to_string_lossy() });
    };
    let graph: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let nodes = graph["nodes"].as_array();
    let communities: std::collections::BTreeSet<String> = nodes
        .map(|n| {
            n.iter()
                .filter_map(|node| node.get("community").map(|c| c.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let built_at = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    // The report's opening (its "god nodes" and surprises) for the page.
    let report = std::fs::read_to_string(out.join("GRAPH_REPORT.md")).unwrap_or_default();
    let summary: String = report.lines().take(40).collect::<Vec<_>>().join("\n");
    json!({
        "built": true,
        "nodes": nodes.map(|n| n.len()).unwrap_or(0),
        "edges": graph["links"].as_array().or(graph["edges"].as_array()).map(|e| e.len()).unwrap_or(0),
        "communities": communities.len(),
        "builtAt": built_at,
        "graphPath": file.to_string_lossy(),
        "htmlPath": out.join("graph.html").to_string_lossy(),
        "reportPath": out.join("GRAPH_REPORT.md").to_string_lossy(),
        "summary": summary,
    })
}

#[tauri::command]
pub async fn codebase_graph(app: AppHandle, id: String) -> Result<Value, String> {
    let (_, item) = codebase(&app, &id)?;
    Ok(graph_info(&path_of(&item)))
}

/// Keep `graphify-out/` out of the codebase's git status without touching
/// its `.gitignore`.
fn exclude_from_git(path: &Path) {
    let info = path.join(".git").join("info");
    if !info.is_dir() {
        return;
    }
    let exclude = info.join("exclude");
    let text = std::fs::read_to_string(&exclude).unwrap_or_default();
    if !text.lines().any(|l| l.trim() == "graphify-out/") {
        let sep = if text.is_empty() || text.ends_with('\n') { "" } else { "\n" };
        let _ = std::fs::write(&exclude, format!("{text}{sep}graphify-out/\n"));
    }
}

/// Build (or bring up to date) the code graph: graphify's AST pass, which
/// needs no model and no keys.
#[tauri::command]
pub async fn codebase_graph_build(app: AppHandle, id: String) -> Result<Value, String> {
    let (_, item) = codebase(&app, &id)?;
    let path = path_of(&item);
    if !path.is_dir() {
        return Err("the folder is missing".into());
    }
    blocking(move || {
        exclude_from_git(&path);
        let target = path.to_string_lossy().into_owned();
        let mut args = vec!["update", target.as_str()];
        if graph_dir(&path).join("graph.json").exists() {
            // Code that was deleted should leave the graph too.
            args.push("--force");
        }
        run("graphify", &args, None).map_err(|e| {
            if e.contains("isn't installed") {
                "graphify isn't installed: pip install graphifyy".to_string()
            } else {
                format!("graphify couldn't map it: {e}")
            }
        })?;
        Ok(graph_info(&path))
    })
    .await
}

#[tauri::command]
pub async fn codebase_graph_open(app: AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let (_, item) = codebase(&app, &id)?;
    let html = graph_dir(&path_of(&item)).join("graph.html");
    if !html.is_file() {
        return Err("map it first".into());
    }
    app.opener()
        .open_path(html.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ─── The Office looks after it ──────────────────────────────────────────────

/// Mark whether the Office looks after this codebase (an executive leads it:
/// triages issues, reviews pull requests, keeps the memory and graph current).
#[tauri::command]
pub async fn codebase_set_managed(app: AppHandle, id: String, managed: bool) -> Result<(), String> {
    let (dir, mut list, at) = find_codebase(&app, &id)?;
    list[at]["managed"] = json!(managed);
    if managed {
        ensure_memory(&dir, &id);
    }
    write_list(&dir.join("index.json"), &list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_git_status() {
        let s = parse_status("## main...origin/main [ahead 2, behind 1]\n M src/a.ts\n?? new file.txt\n");
        assert_eq!(s["branch"], "main");
        assert_eq!(s["upstream"], "origin/main");
        assert_eq!(s["ahead"], 2);
        assert_eq!(s["behind"], 1);
        assert_eq!(s["changedCount"], 2);
        assert_eq!(s["changed"][0]["status"], "M");
        assert_eq!(s["changed"][1]["path"], "new file.txt");

        let s = parse_status("## feature/x\n");
        assert_eq!(s["branch"], "feature/x");
        assert_eq!(s["upstream"], Value::Null);
        assert_eq!(s["changedCount"], 0);

        let s = parse_status("## No commits yet on main\n");
        assert_eq!(s["branch"], "main");
    }

    #[test]
    fn splits_fields() {
        let rows = split_fields("abc\u{1f}Fix it\u{1f}Ann\u{1f}10\n", &["sha", "subject", "author", "at#"]);
        assert_eq!(rows[0]["sha"], "abc");
        assert_eq!(rows[0]["at"], 10_000);
    }
}
