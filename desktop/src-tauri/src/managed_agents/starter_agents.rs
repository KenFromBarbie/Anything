//! Buzz's built-in starter team (Fizz, Honey, Pollen and the Welcome Team),
//! removable in this build.
//!
//! The starter personas and team are re-seeded on every load, built-ins can't
//! be deleted, and a built-in team keeps its personas from being deactivated,
//! so stock Buzz has no way to remove them. Here the Office is the agent
//! system, so the owner can opt out: a marker file next to the agent store
//! stops the re-seeding and drops the stored copies. Deleting the marker
//! brings them back on the next load.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::{managed_agents_base_dir, AgentDefinition, TeamRecord};

pub(crate) const STARTER_PERSONA_IDS: &[&str] =
    &["builtin:fizz", "builtin:honey", "builtin:bumble"];
pub(crate) const STARTER_TEAM_ID: &str = "builtin-team:welcome";
const MARKER: &str = "starter-agents-removed";

fn marker_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(managed_agents_base_dir(app)?.join(MARKER))
}

pub(crate) fn starter_agents_removed<R: tauri::Runtime>(app: &AppHandle<R>) -> bool {
    marker_path(app).map(|path| path.exists()).unwrap_or(false)
}

/// Same check for readers that only know a store file in the agents directory.
pub(crate) fn starter_agents_removed_beside(store_file: &Path) -> bool {
    store_file.with_file_name(MARKER).exists()
}

pub(crate) fn set_starter_agents_removed<R: tauri::Runtime>(
    app: &AppHandle<R>,
    removed: bool,
) -> Result<(), String> {
    let path = marker_path(app)?;
    if removed {
        std::fs::write(
            &path,
            "The Anything starter agents were removed by the owner.\n",
        )
        .map_err(|e| format!("failed to write {}: {e}", path.display()))
    } else if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("failed to remove {}: {e}", path.display()))
    } else {
        Ok(())
    }
}

/// Drop the starter personas. Returns whether anything was removed.
pub(crate) fn strip_starter_personas(records: &mut Vec<AgentDefinition>) -> bool {
    let before = records.len();
    records.retain(|record| !STARTER_PERSONA_IDS.contains(&record.id.as_str()));
    records.len() != before
}

/// Drop the starter team. Returns whether anything was removed.
pub(crate) fn strip_starter_team(records: &mut Vec<TeamRecord>) -> bool {
    let before = records.len();
    records.retain(|record| record.id != STARTER_TEAM_ID);
    records.len() != before
}
