//! How long a pause ends your turn in a call: the silence the speech
//! recogniser waits for before it sends what you said (`stt.rs`).
//!
//! Half a second (the old fixed window) split sentences at every breath, and
//! the agents answered the first half. It's the owner's choice now
//! (Settings → Meetings), 1.2 s unless they pick otherwise, saved in
//! `<app data>/meeting-settings.json`.

use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "meeting-settings.json";
pub const DEFAULT_PAUSE_MS: u32 = 1200;
const MIN_PAUSE_MS: u32 = 400;
const MAX_PAUSE_MS: u32 = 4000;

static PAUSE_FRAMES: AtomicUsize = AtomicUsize::new(frames_for(DEFAULT_PAUSE_MS));

const fn frames_for(ms: u32) -> usize {
    // Rounded up: never shorter than asked.
    ((ms as usize) * 1000).div_ceil(16_000)
}

/// Frames of silence that end an utterance, as `stt.rs` counts them.
pub fn silence_flush_frames() -> usize {
    PAUSE_FRAMES.load(Ordering::Relaxed)
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSettings {
    pub pause_ms: u32,
}

impl Default for MeetingSettings {
    fn default() -> Self {
        Self {
            pause_ms: DEFAULT_PAUSE_MS,
        }
    }
}

fn clamp(ms: u32) -> u32 {
    ms.clamp(MIN_PAUSE_MS, MAX_PAUSE_MS)
}

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(SETTINGS_FILE))
}

fn read(app: &AppHandle) -> MeetingSettings {
    path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice::<MeetingSettings>(&bytes).ok())
        .map(|s| MeetingSettings {
            pause_ms: clamp(s.pause_ms),
        })
        .unwrap_or_default()
}

/// At launch: use the saved pause.
pub fn load_for_app(app: &AppHandle) {
    PAUSE_FRAMES.store(frames_for(read(app).pause_ms), Ordering::Relaxed);
}

#[tauri::command]
pub fn meeting_settings_get(app: AppHandle) -> MeetingSettings {
    read(&app)
}

/// Takes effect from the next pause, in a call already going too.
#[tauri::command]
pub fn meeting_settings_set_pause(app: AppHandle, pause_ms: u32) -> Result<MeetingSettings, String> {
    let settings = MeetingSettings {
        pause_ms: clamp(pause_ms),
    };
    let file = path(&app).ok_or("no app data folder")?;
    let json = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    crate::managed_agents::storage::atomic_write_json(&file, &json)?;
    PAUSE_FRAMES.store(frames_for(settings.pause_ms), Ordering::Relaxed);
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Milliseconds of 16 kHz audio in one VAD frame (256 samples).
    const FRAME_MS: f64 = 16.0;

    #[test]
    fn pauses_become_whole_frames() {
        assert_eq!(frames_for(500), 32);
        assert_eq!(frames_for(1200), 75);
        assert!(frames_for(DEFAULT_PAUSE_MS) as f64 * FRAME_MS >= DEFAULT_PAUSE_MS as f64);
    }

    #[test]
    fn pauses_stay_in_range() {
        assert_eq!(clamp(10), MIN_PAUSE_MS);
        assert_eq!(clamp(60_000), MAX_PAUSE_MS);
        assert_eq!(clamp(1500), 1500);
    }
}
