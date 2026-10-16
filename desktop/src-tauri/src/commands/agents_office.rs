//! Michael, the Office's orchestrator, as one of the owner's Buzz agents.
//!
//! Michael runs in the Office (Munder Difflin's god agent), not on a Buzz
//! harness. Buzz still holds his identity the way it holds every managed agent:
//! a record in `managed-agents.json`, his key in the OS keyring, and the owner's
//! NIP-OA auth tag on his published profile, so he is discoverable as the
//! owner's agent and appears on the Agents page.
//!
//! The record uses `BackendKind::Provider { id: "office" }`: "managed
//! externally" is exactly true, and every non-Local path already refuses to
//! spawn a local harness for it. `backend_agent_id` is set while the office
//! runs, which is what makes the card read as deployed.
//!
//! The other agents hired on the floor get the same treatment once the office
//! reports them (`ensure_office_workers`), so they can work in channels too.
//! Their records carry `backend.config.officeAgentId`, the floor's id for them;
//! Michael's record has none.

use nostr::{Keys, ToBech32};
use tauri::{AppHandle, Manager};

use crate::app_state::AppState;
use crate::managed_agents::{
    load_managed_agents, save_managed_agents, BackendKind, ManagedAgentRecord, DEFAULT_ACP_COMMAND,
    DEFAULT_AGENT_TURN_TIMEOUT_SECONDS,
};
use crate::util::now_iso;

pub(crate) const OFFICE_BACKEND_ID: &str = "office";
const OFFICE_AGENT_NAME: &str = "Michael";
const OFFICE_AGENT_ABOUT: &str =
    "Orchestrates the Office: routes work to the agents on its floor (Munder Difflin).";
const OFFICE_WORKER_ABOUT: &str =
    "Works on the Office floor (Munder Difflin); Michael routes work to it.";

/// Michael's identity, as handed to the office sidecar.
pub(crate) struct OfficeAgentIdentity {
    pub secret_hex: String,
    pub auth_tag: String,
}

/// A floor agent's identity, as handed to the office sidecar.
#[derive(serde::Serialize)]
pub(crate) struct OfficeWorkerIdentity {
    pub id: String,
    pub name: String,
    pub key: String,
    #[serde(rename = "authTag")]
    pub auth_tag: String,
}

pub(crate) fn is_office_backend(backend: &BackendKind) -> bool {
    matches!(backend, BackendKind::Provider { id, .. } if id == OFFICE_BACKEND_ID)
}

/// The floor's id for the agent an office record belongs to; `None` for
/// Michael's record (and for anything that isn't an office record).
fn office_agent_id(backend: &BackendKind) -> Option<&str> {
    match backend {
        BackendKind::Provider { id, config } if id == OFFICE_BACKEND_ID => {
            config.get("officeAgentId").and_then(|v| v.as_str())
        }
        _ => None,
    }
}

fn is_michael(record: &ManagedAgentRecord) -> bool {
    is_office_backend(&record.backend) && office_agent_id(&record.backend).is_none()
}

/// Whether `pubkey` is one of the Office's agent records (Michael or a
/// floor agent).
pub(crate) fn is_office_agent(app: &AppHandle, pubkey: &str) -> bool {
    load_managed_agents(app)
        .map(|records| {
            records
                .iter()
                .any(|r| r.pubkey == pubkey && is_office_backend(&r.backend))
        })
        .unwrap_or(false)
}

/// Whether `pubkey` is Michael's record, whose lifecycle is the Office's.
pub(crate) fn is_office_michael(app: &AppHandle, pubkey: &str) -> bool {
    load_managed_agents(app)
        .map(|records| records.iter().any(|r| r.pubkey == pubkey && is_michael(r)))
        .unwrap_or(false)
}

fn owner_auth_tag(state: &AppState, agent: &Keys) -> Result<String, String> {
    let owner_keys = state.signing_keys()?;
    // Bridge nostr 0.37 → 0.36 (buzz-sdk) via hex round-trip, as create does.
    let compat_owner = nostr::Keys::parse(&owner_keys.secret_key().to_secret_hex())
        .map_err(|e| format!("failed to bridge owner keys: {e}"))?;
    let compat_agent = nostr::PublicKey::from_hex(&agent.public_key().to_hex())
        .map_err(|e| format!("failed to bridge agent pubkey: {e}"))?;
    buzz_sdk_pkg::nip_oa::compute_auth_tag(&compat_owner, &compat_agent, "")
        .map_err(|e| format!("failed to compute NIP-OA auth tag: {e}"))
}

fn office_record(
    keys: &Keys,
    private_key_nsec: String,
    auth_tag: String,
    name: &str,
    about: &str,
    office_agent_id: Option<&str>,
) -> ManagedAgentRecord {
    let now = now_iso();
    ManagedAgentRecord {
        pubkey: keys.public_key().to_hex(),
        name: name.to_string(),
        description: Some(about.to_string()),
        persona_id: None,
        team_id: None,
        private_key_nsec,
        auth_tag: Some(auth_tag),
        // Empty resolves to the active workspace relay at read time.
        relay_url: String::new(),
        avatar_url: None,
        acp_command: DEFAULT_ACP_COMMAND.to_string(),
        agent_command: OFFICE_BACKEND_ID.to_string(),
        agent_command_override: None,
        agent_args: Vec::new(),
        mcp_command: String::new(),
        turn_timeout_seconds: DEFAULT_AGENT_TURN_TIMEOUT_SECONDS,
        idle_timeout_seconds: None,
        max_turn_duration_seconds: None,
        parallelism: 1,
        session_policy: Default::default(),
        system_prompt: None,
        model: None,
        provider: None,
        persona_source_version: None,
        env_vars: Default::default(),
        // The office starts its agents, never Buzz.
        start_on_app_launch: false,
        auto_restart_on_config_change: false,
        runtime_pid: None,
        backend: BackendKind::Provider {
            id: OFFICE_BACKEND_ID.to_string(),
            config: match office_agent_id {
                Some(id) => serde_json::json!({ "officeAgentId": id }),
                None => serde_json::json!({}),
            },
        },
        backend_agent_id: None,
        provider_policy_pending: false,
        provider_binary_path: None,
        persona_team_dir: None,
        persona_name_in_team: None,
        created_at: now.clone(),
        updated_at: now,
        last_started_at: None,
        last_stopped_at: None,
        last_exit_code: None,
        last_error: None,
        last_error_code: None,
        respond_to: Default::default(),
        respond_to_allowlist: Vec::new(),
        display_name: None,
        slug: None,
        runtime: None,
        name_pool: Vec::new(),
        is_builtin: false,
        is_active: true,
        shared: false,
        source_team: None,
        source_team_persona_slug: None,
        catalog_source: None,
        team_catalog_source: None,
        definition_respond_to: None,
        definition_respond_to_allowlist: Vec::new(),
        definition_parallelism: None,
        relay_mesh: None,
        effort_level: None,
    }
}

/// Michael's identity, creating his Buzz record on first use.
///
/// `import_secret_hex` is the key the office minted before Buzz owned it; it is
/// adopted so Michael keeps his pubkey (channel membership, open threads). With
/// no key to import, a fresh one is generated.
pub(crate) async fn ensure_office_agent(
    app: &AppHandle,
    import_secret_hex: Option<String>,
) -> Result<OfficeAgentIdentity, String> {
    let state = app.state::<AppState>();

    // Existing record: reuse it. Its key is rehydrated from the keyring on load.
    let existing = {
        let _store_guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|e| e.to_string())?;
        load_managed_agents(app)?.into_iter().find(is_michael)
    };
    if let Some(record) = existing {
        let keys = Keys::parse(&record.private_key_nsec)
            .map_err(|e| format!("office agent key unreadable: {e}"))?;
        let auth_tag = match record.auth_tag {
            Some(tag) => tag,
            None => owner_auth_tag(&state, &keys)?,
        };
        return Ok(OfficeAgentIdentity {
            secret_hex: keys.secret_key().to_secret_hex(),
            auth_tag,
        });
    }

    let keys = match import_secret_hex {
        Some(hex) => Keys::parse(&hex).map_err(|e| format!("office agent key invalid: {e}"))?,
        None => Keys::generate(),
    };
    let private_key_nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode office agent key: {e}"))?;
    let auth_tag = owner_auth_tag(&state, &keys)?;

    {
        let _store_guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|e| e.to_string())?;
        let mut records = load_managed_agents(app)?;
        let pubkey = keys.public_key().to_hex();
        if records.iter().any(|r| r.pubkey == pubkey) {
            return Err(format!("agent {pubkey} already exists"));
        }
        records.push(office_record(
            &keys,
            private_key_nsec,
            auth_tag.clone(),
            OFFICE_AGENT_NAME,
            OFFICE_AGENT_ABOUT,
            None,
        ));
        save_managed_agents(app, &records)?;
        if let Some(record) = records.iter().find(|r| r.pubkey == pubkey) {
            super::retain_managed_agent_pending(app, &state, record);
        }
    }

    // Publish his profile with the owner's auth tag, then the owner policy that
    // makes him discoverable as the owner's agent. Best-effort, as in create.
    let profile_error = super::publish_agent_profile_with_about(
        &state,
        "",
        &keys,
        OFFICE_AGENT_NAME,
        None,
        Some(OFFICE_AGENT_ABOUT),
        Some(&auth_tag),
    )
    .await;
    if let Some(error) =
        crate::commands::agent_models::flush_managed_agent_policy(app, &state, profile_error).await
    {
        eprintln!("buzz-desktop: office agent publish: {error}");
    }

    Ok(OfficeAgentIdentity {
        secret_hex: keys.secret_key().to_secret_hex(),
        auth_tag,
    })
}

/// Mark Michael deployed when the office starts; when it stops, every office
/// record (Michael and the floor's agents) reads as stopped.
pub(crate) fn set_office_agent_deployed(app: &AppHandle, deployed: bool) {
    let state = app.state::<AppState>();
    let result = (|| -> Result<(), String> {
        let _store_guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|e| e.to_string())?;
        let mut records = load_managed_agents(app)?;
        let now = now_iso();
        let mut changed = false;
        for record in records.iter_mut() {
            let applies = if deployed {
                is_michael(record)
            } else {
                is_office_backend(&record.backend)
            };
            if !applies {
                continue;
            }
            record.backend_agent_id = deployed.then(|| OFFICE_BACKEND_ID.to_string());
            if deployed {
                record.last_started_at = Some(now.clone());
            } else {
                record.last_stopped_at = Some(now.clone());
            }
            record.updated_at = now.clone();
            changed = true;
        }
        if changed {
            save_managed_agents(app, &records)?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("buzz-desktop: office agent status: {error}");
    }
}

/// Give each agent on the Office floor (other than Michael) its own Buzz
/// identity, owner-attested like Michael's, so it can work in channels.
/// `roster` is the floor as the office reports it: (floor agent id, name).
/// Records of agents no longer on the floor are kept, so an agent that comes
/// back keeps its identity, but read as not deployed.
pub(crate) async fn ensure_office_workers(
    app: &AppHandle,
    roster: &[(String, String)],
) -> Result<Vec<OfficeWorkerIdentity>, String> {
    let state = app.state::<AppState>();
    let mut created: Vec<(Keys, String, String)> = Vec::new();
    let mut identities = Vec::new();
    {
        let _store_guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|e| e.to_string())?;
        let mut records = load_managed_agents(app)?;
        let mut changed = false;
        for (floor_id, name) in roster {
            let existing = records
                .iter()
                .find(|r| office_agent_id(&r.backend) == Some(floor_id.as_str()));
            let (keys, auth_tag, name) = match existing {
                Some(record) => {
                    let keys = Keys::parse(&record.private_key_nsec)
                        .map_err(|e| format!("office agent key unreadable: {e}"))?;
                    let auth_tag = match &record.auth_tag {
                        Some(tag) => tag.clone(),
                        None => owner_auth_tag(&state, &keys)?,
                    };
                    (keys, auth_tag, record.name.clone())
                }
                None => {
                    let keys = Keys::generate();
                    let private_key_nsec = keys
                        .secret_key()
                        .to_bech32()
                        .map_err(|e| format!("failed to encode office agent key: {e}"))?;
                    let auth_tag = owner_auth_tag(&state, &keys)?;
                    records.push(office_record(
                        &keys,
                        private_key_nsec,
                        auth_tag.clone(),
                        name,
                        OFFICE_WORKER_ABOUT,
                        Some(floor_id),
                    ));
                    created.push((keys.clone(), name.clone(), auth_tag.clone()));
                    changed = true;
                    (keys, auth_tag, name.clone())
                }
            };
            identities.push(OfficeWorkerIdentity {
                id: floor_id.clone(),
                name,
                key: keys.secret_key().to_secret_hex(),
                auth_tag,
            });
        }
        // Deployed while on the floor.
        let now = now_iso();
        for record in records.iter_mut() {
            let on_floor = match office_agent_id(&record.backend) {
                Some(floor_id) => roster.iter().any(|(id, _)| id == floor_id),
                None => continue,
            };
            if on_floor == record.backend_agent_id.is_some() {
                continue;
            }
            record.backend_agent_id = on_floor.then(|| OFFICE_BACKEND_ID.to_string());
            if on_floor {
                record.last_started_at = Some(now.clone());
            } else {
                record.last_stopped_at = Some(now.clone());
            }
            record.updated_at = now.clone();
            changed = true;
        }
        if changed {
            save_managed_agents(app, &records)?;
        }
        for (keys, _, _) in &created {
            let pubkey = keys.public_key().to_hex();
            if let Some(record) = records.iter().find(|r| r.pubkey == pubkey) {
                super::retain_managed_agent_pending(app, &state, record);
            }
        }
    }

    // Publish each new agent's profile with the owner's auth tag, then the
    // owner policy that lists them as the owner's agents. Best-effort.
    if !created.is_empty() {
        let mut profile_error = None;
        for (keys, name, auth_tag) in &created {
            if let Some(error) = super::publish_agent_profile_with_about(
                &state,
                "",
                keys,
                name,
                None,
                Some(OFFICE_WORKER_ABOUT),
                Some(auth_tag),
            )
            .await
            {
                profile_error = Some(error);
            }
        }
        if let Some(error) =
            crate::commands::agent_models::flush_managed_agent_policy(app, &state, profile_error)
                .await
        {
            eprintln!("buzz-desktop: office agents publish: {error}");
        }
    }
    Ok(identities)
}
