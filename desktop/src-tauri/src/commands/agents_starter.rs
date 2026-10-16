//! Remove or restore Buzz's built-in starter team (Fizz, Honey, Pollen and the
//! Welcome Team). See `managed_agents::starter_agents`.

use serde::Serialize;
use tauri::AppHandle;

use crate::managed_agents::starter_agents::{set_starter_agents_removed, STARTER_PERSONA_IDS};
use crate::managed_agents::{load_managed_agents, load_personas, load_teams};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterAgentsRemoval {
    /// Starter agent instances deleted (identity, key and runtime).
    pub deleted_agents: Vec<String>,
}

/// Delete the starter agents' instances, then stop Buzz from re-seeding the
/// starter personas and team.
#[tauri::command]
pub async fn remove_starter_agents(app: AppHandle) -> Result<StarterAgentsRemoval, String> {
    let instances: Vec<(String, String)> = load_managed_agents(&app)?
        .into_iter()
        .filter(|record| {
            record
                .persona_id
                .as_deref()
                .is_some_and(|id| STARTER_PERSONA_IDS.contains(&id))
        })
        .map(|record| (record.pubkey, record.name))
        .collect();

    let mut deleted_agents = Vec::new();
    for (pubkey, name) in instances {
        // The regular delete path: stops the runtime, removes the keyring
        // entry, and tombstones the agent on the relay.
        super::delete_managed_agent(pubkey, None, app.clone()).await?;
        deleted_agents.push(name);
    }

    set_starter_agents_removed(&app, true)?;
    // Loading now drops the stored starter personas and team.
    load_teams(&app)?;
    load_personas(&app)?;
    Ok(StarterAgentsRemoval { deleted_agents })
}

/// Bring the starter personas and team back (their agents are not recreated;
/// start them from the Agents page like any persona).
#[tauri::command]
pub async fn restore_starter_agents(app: AppHandle) -> Result<(), String> {
    set_starter_agents_removed(&app, false)?;
    load_personas(&app)?;
    load_teams(&app)?;
    Ok(())
}
