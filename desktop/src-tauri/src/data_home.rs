//! A guard against starting with the wrong data folder.
//!
//! The app's data folder can physically live in different places under the
//! same path: started from inside a packaged host (an MSIX app such as the
//! Claude desktop app), Windows redirects `AppData` into that package's
//! private copy; started from outside, the same path is the plain folder. A
//! start against the *other* copy looks like a fresh install: settings wiped,
//! a handful of agents instead of dozens, an empty Create — and the Office
//! would mint a second CEO identity.
//!
//! So the app remembers where its data physically was and how much there was,
//! in a marker *outside* `AppData` (`~/.anything/data-home.json`, which looks
//! the same from both sides). When a later start resolves to a different
//! physical folder holding less, the owner is told and nothing new is minted.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Marker {
    /// Where the data folder physically is.
    physical: String,
    /// Agent records there at last look.
    agents: usize,
    updated: String,
}

/// The data folder isn't the one last used, and holds less.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Mismatch {
    /// Where the data was (and still is).
    pub expected: String,
    /// Where this start is looking.
    pub actual: String,
    pub agents_then: usize,
    pub agents_now: usize,
}

#[derive(Default)]
pub struct DataHomeState(Mutex<Option<Mismatch>>);

fn marker_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".anything").join("data-home.json"))
}

/// The physical location of the app's data folder (redirection resolved).
fn physical_dir(data_dir: &Path) -> Option<String> {
    std::fs::create_dir_all(data_dir).ok()?;
    // A directory can resolve to its plain path while the files in it resolve
    // to the redirected copy, so resolve a file.
    let probe = data_dir.join(".data-home-probe");
    std::fs::write(&probe, b"").ok()?;
    let real = std::fs::canonicalize(&probe).ok()?;
    let _ = std::fs::remove_file(&probe);
    let dir = real.parent()?.to_string_lossy().into_owned();
    Some(dir.trim_start_matches(r"\\?\").to_string())
}

fn agent_count(data_dir: &Path) -> usize {
    std::fs::read(data_dir.join("agents").join("managed-agents.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|v| v.as_array().map(Vec::len))
        .unwrap_or(0)
}

/// What to do with what this start sees, given what was remembered.
/// Pure, for tests: returns the marker to save (if any) and the mismatch.
fn decide(
    saved: Option<&Marker>,
    physical: &str,
    agents: usize,
    now: &str,
) -> (Option<Marker>, Option<Mismatch>) {
    let fresh = || Marker { physical: physical.to_string(), agents, updated: now.to_string() };
    match saved {
        None => (Some(fresh()), None),
        Some(m) if m.physical.eq_ignore_ascii_case(physical) => (Some(fresh()), None),
        // A different folder with as much or more in it: the data moved here.
        Some(m) if agents >= m.agents => (Some(fresh()), None),
        Some(m) => (
            None,
            Some(Mismatch {
                expected: m.physical.clone(),
                actual: physical.to_string(),
                agents_then: m.agents,
                agents_now: agents,
            }),
        ),
    }
}

fn load_marker() -> Option<Marker> {
    serde_json::from_slice(&std::fs::read(marker_path()?).ok()?).ok()
}

fn save_marker(marker: &Marker) {
    let Some(path) = marker_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_vec_pretty(marker) {
        let _ = std::fs::write(path, json);
    }
}

/// At startup: compare this start's data folder with the remembered one.
pub fn check(app: &AppHandle) {
    let Ok(data_dir) = app.path().app_data_dir() else { return };
    let Some(physical) = physical_dir(&data_dir) else { return };
    let (save, mismatch) = decide(
        load_marker().as_ref(),
        &physical,
        agent_count(&data_dir),
        &crate::util::now_iso(),
    );
    if let Some(marker) = save {
        save_marker(&marker);
    }
    if let Some(m) = &mismatch {
        eprintln!(
            "buzz-desktop: data folder mismatch: was {} ({} agents), now {} ({} agents)",
            m.expected, m.agents_then, m.actual, m.agents_now
        );
    }
    if let Some(state) = app.try_state::<DataHomeState>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = mismatch;
        }
    }
}

/// The mismatch found at startup, if any (and not accepted since).
pub fn mismatch(app: &AppHandle) -> Option<Mismatch> {
    app.try_state::<DataHomeState>()?.0.lock().ok()?.clone()
}

/// Why nothing new should be minted right now, if the data folder is wrong.
pub fn refuse_minting(app: &AppHandle) -> Result<(), String> {
    match mismatch(app) {
        Some(m) => Err(format!(
            "Anything is looking at a different data folder than usual ({} agents here, {} where your data is: {}). Close it and start it the way you normally do; nothing was created.",
            m.agents_now, m.agents_then, m.expected
        )),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn data_home_status(app: AppHandle) -> Option<Mismatch> {
    mismatch(&app)
}

/// The owner says this folder is the one to use from now on.
#[tauri::command]
pub fn data_home_accept(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let physical = physical_dir(&data_dir).ok_or("couldn't resolve the data folder")?;
    save_marker(&Marker { physical, agents: agent_count(&data_dir), updated: crate::util::now_iso() });
    if let Some(state) = app.try_state::<DataHomeState>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = None;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker(physical: &str, agents: usize) -> Marker {
        Marker { physical: physical.into(), agents, updated: "t".into() }
    }

    #[test]
    fn first_start_remembers_the_folder() {
        let (save, mismatch) = decide(None, r"C:\data", 3, "now");
        assert_eq!(save, Some(Marker { physical: r"C:\data".into(), agents: 3, updated: "now".into() }));
        assert_eq!(mismatch, None);
    }

    #[test]
    fn the_same_folder_is_fine_and_refreshes_the_count() {
        let saved = marker(r"C:\Data", 57);
        let (save, mismatch) = decide(Some(&saved), r"c:\data", 60, "now");
        assert_eq!(save.map(|m| m.agents), Some(60));
        assert_eq!(mismatch, None);
    }

    #[test]
    fn another_folder_with_less_in_it_is_a_mismatch_and_keeps_the_marker() {
        let saved = marker(r"C:\Packages\Host\Roaming\app", 339);
        let (save, mismatch) = decide(Some(&saved), r"C:\Users\me\AppData\Roaming\app", 5, "now");
        assert_eq!(save, None);
        let m = mismatch.expect("mismatch");
        assert_eq!((m.agents_then, m.agents_now), (339, 5));
        assert_eq!(m.expected, r"C:\Packages\Host\Roaming\app");
    }

    #[test]
    fn another_folder_with_as_much_is_adopted() {
        let saved = marker(r"C:\old", 10);
        let (save, mismatch) = decide(Some(&saved), r"D:\new", 10, "now");
        assert_eq!(save.map(|m| m.physical), Some(r"D:\new".to_string()));
        assert_eq!(mismatch, None);
    }
}
