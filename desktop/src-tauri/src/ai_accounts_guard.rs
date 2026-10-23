//! Smart usage management for the AI accounts: per-account caps (tokens in
//! the last 5 hours, today, the last 7 days, or a share of the plan's own
//! limit) and what happens when one is reached: switch the agents to another
//! account, freeze them, or just warn. A freeze pauses every agent of that
//! engine in every running Office (they stop at their next step) until it is
//! lifted, by hand or when the usage window rolls back under the cap.
//!
//! Checked once a minute, and right away when a rule or freeze changes.
//! Rules, freezes and a short activity log live in `ai-accounts/guard.json`.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::{
    account_at_usage, activate, load_registry, now_ms, root, Engine, Usage, ENGINES,
};

const TICK: Duration = Duration::from_secs(60);
/// A cap that's only warned about is warned about at most this often.
const WARN_EVERY_MS: i64 = 60 * 60 * 1000;
const LOG_KEEP: usize = 100;

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AtCap {
    /// Move the engine's agents to the next account under its own caps;
    /// freeze when there's none.
    #[default]
    Switch,
    Freeze,
    Warn,
}

#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    #[serde(default)]
    pub cap5h: Option<u64>,
    #[serde(default)]
    pub cap_day: Option<u64>,
    #[serde(default)]
    pub cap_week: Option<u64>,
    /// Percent of the plan's own limit (where the CLI reports one).
    #[serde(default)]
    pub cap_percent: Option<f64>,
    #[serde(default)]
    pub at_cap: AtCap,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Freeze {
    /// Set by hand: only lifted by hand.
    pub manual: bool,
    pub reason: String,
    pub since: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: i64,
    pub engine: String,
    pub text: String,
}

#[derive(Clone, Default, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GuardState {
    /// By "engine:account id" ("default" for this computer's sign-in).
    #[serde(default)]
    pub rules: HashMap<String, Rule>,
    /// By engine.
    #[serde(default)]
    pub frozen: HashMap<String, Freeze>,
    #[serde(default)]
    pub log: Vec<LogEntry>,
    #[serde(default)]
    warned: HashMap<String, i64>,
}

fn rule_key(engine: Engine, id: &str) -> String {
    format!("{}:{id}", engine.key())
}

fn load(app: &AppHandle) -> GuardState {
    root(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("guard.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, state: &GuardState) -> Result<(), String> {
    let dir = root(app)?;
    super::write_atomic(
        &dir.join("guard.json"),
        &serde_json::to_string_pretty(state).map_err(|e| e.to_string())?,
    )
}

fn note(state: &mut GuardState, engine: Engine, text: String) {
    state.log.push(LogEntry {
        at: now_ms(),
        engine: engine.key().into(),
        text,
    });
    if state.log.len() > LOG_KEEP {
        state.log.drain(..state.log.len() - LOG_KEEP);
    }
}

fn total(w: &super::Window) -> u64 {
    w.input + w.output + w.cache_read + w.cache_write
}

fn fmt_tokens(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1e6)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1e3)
    } else {
        n.to_string()
    }
}

/// Which cap `usage` is over, as words; None when it's under all of them.
pub fn over_cap(rule: &Rule, usage: &Usage) -> Option<String> {
    let windows = [
        (rule.cap5h, total(&usage.last5h), "5-hour"),
        (rule.cap_day, total(&usage.today), "daily"),
        (rule.cap_week, total(&usage.week), "7-day"),
    ];
    for (cap, used, name) in windows {
        if let Some(cap) = cap.filter(|c| *c > 0) {
            if used >= cap {
                return Some(format!(
                    "{name} cap of {} reached ({} used)",
                    fmt_tokens(cap),
                    fmt_tokens(used)
                ));
            }
        }
    }
    if let Some(cap) = rule.cap_percent.filter(|c| *c > 0.0) {
        if let Some(limit) = usage.limits.iter().find(|l| l.used_percent >= cap) {
            return Some(format!(
                "{} at {:.0}% (cap {cap:.0}%)",
                limit.label, limit.used_percent
            ));
        }
    }
    None
}

fn account_label(app: &AppHandle, engine: Engine, id: &str) -> String {
    if id == "default" {
        return "this computer's sign-in".into();
    }
    load_registry(app)
        .engines
        .get(engine.key())
        .and_then(|e| e.profiles.iter().find(|p| p.id == id))
        .map(|p| p.label.clone())
        .unwrap_or_else(|| id.to_string())
}

/// Every account of the engine that's signed in, "default" first.
fn signed_in_accounts(app: &AppHandle, engine: Engine) -> Vec<String> {
    let registry = load_registry(app);
    let mut ids = Vec::new();
    if super::identity(engine, &engine.default_home(), true).signed_in {
        ids.push("default".to_string());
    }
    if let Some(entry) = registry.engines.get(engine.key()) {
        for profile in &entry.profiles {
            if let Ok(dir) = super::profile_dir(app, engine, &profile.id) {
                if super::identity(engine, &dir, false).signed_in {
                    ids.push(profile.id.clone());
                }
            }
        }
    }
    ids
}

/// Tell every running Office to pause or resume this engine's agents.
fn broadcast_freeze(engine: Engine, on: bool) {
    crate::office::send_line(
        &serde_json::json!({ "type": "freeze", "provider": engine.key(), "on": on }).to_string(),
    );
}

/// One pass over the engines: apply the rules to the accounts in use.
pub fn check(app: &AppHandle) {
    let mut state = load(app);
    let before = serde_json::to_string(&state).unwrap_or_default();
    let mut changed_accounts = false;
    for engine in ENGINES {
        let active = load_registry(app)
            .engines
            .get(engine.key())
            .and_then(|e| e.active.clone())
            .unwrap_or_else(|| "default".into());
        let rule = state.rules.get(&rule_key(engine, &active)).cloned();
        let over = rule.as_ref().and_then(|rule| {
            account_at_usage(app, engine, &active)
                .ok()
                .and_then(|usage| over_cap(rule, &usage))
        });

        // An automatic freeze lifts once the account in use is back under.
        if let Some(freeze) = state.frozen.get(engine.key()).cloned() {
            if !freeze.manual && over.is_none() {
                state.frozen.remove(engine.key());
                note(
                    &mut state,
                    engine,
                    format!("Unfroze {} agents: back under the cap.", engine.label()),
                );
                broadcast_freeze(engine, false);
            }
        }

        if let (Some(rule), Some(reason)) = (rule, over) {
            let from = account_label(app, engine, &active);
            let mut freeze_for = None;
            match rule.at_cap {
                AtCap::Warn => {
                    let key = rule_key(engine, &active);
                    let last = state.warned.get(&key).copied().unwrap_or(0);
                    if now_ms() - last > WARN_EVERY_MS {
                        state.warned.insert(key, now_ms());
                        let text = format!("{} on {from}: {reason}.", engine.label());
                        note(&mut state, engine, text.clone());
                        let _ = app.emit("ai-usage-alert", text);
                    }
                }
                AtCap::Freeze => freeze_for = Some(reason),
                AtCap::Switch => {
                    let next = signed_in_accounts(app, engine).into_iter().find(|id| {
                        id != &active
                            && match state.rules.get(&rule_key(engine, id)) {
                                None => true,
                                Some(r) => account_at_usage(app, engine, id)
                                    .map(|u| over_cap(r, &u).is_none())
                                    .unwrap_or(false),
                            }
                    });
                    match next {
                        Some(id) => match activate(app, engine, &id) {
                            Ok(()) => {
                                changed_accounts = true;
                                let to = account_label(app, engine, &id);
                                let text = format!(
                                    "Switched {} agents from {from} to {to}: {reason}. New and restarted agents use {to}.",
                                    engine.label()
                                );
                                note(&mut state, engine, text.clone());
                                let _ = app.emit("ai-usage-alert", text);
                            }
                            Err(error) => {
                                freeze_for = Some(format!("{reason}; couldn't switch ({error})"))
                            }
                        },
                        None => {
                            freeze_for =
                                Some(format!("{reason}, and no other account is under its caps"))
                        }
                    }
                }
            }
            if let Some(reason) = freeze_for {
                if !state.frozen.contains_key(engine.key()) {
                    state.frozen.insert(
                        engine.key().into(),
                        Freeze {
                            manual: false,
                            reason: reason.clone(),
                            since: now_ms(),
                        },
                    );
                    let text = format!("Froze {} agents on {from}: {reason}.", engine.label());
                    note(&mut state, engine, text.clone());
                    let _ = app.emit("ai-usage-alert", text);
                }
            }
        }

        // Held every pass, so agents started since (or an Office that just
        // came up) are paused too.
        if state.frozen.contains_key(engine.key()) {
            broadcast_freeze(engine, true);
        }
    }
    if serde_json::to_string(&state).unwrap_or_default() != before {
        let _ = save(app, &state);
        let _ = app.emit("ai-usage-guard", ());
    }
    if changed_accounts {
        let _ = app.emit("ai-usage-guard", ());
    }
}

/// Start the once-a-minute check.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let handle = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || check(&handle)).await;
            tokio::time::sleep(TICK).await;
        }
    });
}

fn check_soon(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || check(&handle));
}

#[tauri::command]
pub fn ai_accounts_guard(app: AppHandle) -> GuardState {
    let mut state = load(&app);
    state.log.reverse(); // newest first
    state
}

#[tauri::command]
pub fn ai_accounts_set_rule(
    app: AppHandle,
    engine: String,
    id: String,
    rule: Option<Rule>,
) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    let mut state = load(&app);
    let key = rule_key(engine, &id);
    let empty = |r: &Rule| {
        r.cap5h.is_none() && r.cap_day.is_none() && r.cap_week.is_none() && r.cap_percent.is_none()
    };
    match rule {
        Some(rule) if !empty(&rule) => {
            state.rules.insert(key, rule);
        }
        _ => {
            state.rules.remove(&key);
        }
    }
    save(&app, &state)?;
    check_soon(&app);
    Ok(())
}

/// Freeze or unfreeze an engine's agents by hand.
#[tauri::command]
pub fn ai_accounts_freeze(app: AppHandle, engine: String, on: bool) -> Result<(), String> {
    let engine = Engine::parse(&engine)?;
    let mut state = load(&app);
    if on {
        state.frozen.insert(
            engine.key().into(),
            Freeze {
                manual: true,
                reason: "frozen by hand".into(),
                since: now_ms(),
            },
        );
        note(&mut state, engine, format!("Froze {} agents by hand.", engine.label()));
        broadcast_freeze(engine, true);
    } else if state.frozen.remove(engine.key()).is_some() {
        note(&mut state, engine, format!("Unfroze {} agents by hand.", engine.label()));
        broadcast_freeze(engine, false);
    }
    save(&app, &state)?;
    let _ = app.emit("ai-usage-guard", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage_with(last5h: u64, percent: f64) -> Usage {
        let mut usage = Usage::default();
        usage.last5h.input = last5h;
        usage.limits.push(super::super::Limit {
            label: "5-hour limit".into(),
            used_percent: percent,
            window_minutes: Some(300),
            resets_at: None,
        });
        usage
    }

    #[test]
    fn a_token_cap_is_reached_at_or_over_it() {
        let rule = Rule {
            cap5h: Some(1_000),
            ..Rule::default()
        };
        assert!(over_cap(&rule, &usage_with(999, 0.0)).is_none());
        let reason = over_cap(&rule, &usage_with(1_000, 0.0)).unwrap();
        assert!(reason.contains("5-hour cap"), "{reason}");
    }

    #[test]
    fn a_percent_cap_reads_the_plan_limit() {
        let rule = Rule {
            cap_percent: Some(90.0),
            ..Rule::default()
        };
        assert!(over_cap(&rule, &usage_with(0, 89.0)).is_none());
        assert!(over_cap(&rule, &usage_with(0, 91.0)).is_some());
    }

    #[test]
    fn no_caps_means_never_over() {
        assert!(over_cap(&Rule::default(), &usage_with(u64::MAX / 2, 100.0)).is_none());
    }
}
