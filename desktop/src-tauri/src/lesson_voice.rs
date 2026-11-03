//! The app's own voice for lessons: Piper voices run on sherpa-onnx, one per
//! language, so a Dutch lesson is read by a Dutch voice whatever the computer
//! has installed. A voice is downloaded only when the owner asks for it, into
//! `~/.buzz/models/lesson-voices/`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::app_state::AppState;
use crate::huddle::models::{download_file, extract_archive};

/// Language, Piper voice, and its name in the app.
const VOICES: &[(&str, &str, &str)] = &[
    ("nl", "nl_NL-ronnie-medium", "Dutch"),
    ("en", "en_US-amy-medium", "English"),
    ("de", "de_DE-thorsten-medium", "German"),
    ("fr", "fr_FR-siwis-medium", "French"),
    ("es", "es_ES-davefx-medium", "Spanish"),
];
const MAX_VOICE_BYTES: u64 = 150 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 600;
const PROGRESS_EVENT: &str = "lesson-voice-progress";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonVoice {
    lang: &'static str,
    label: &'static str,
    voice: &'static str,
    installed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    lang: String,
    done: u64,
    total: Option<u64>,
}

fn voices_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".buzz").join("models").join("lesson-voices"))
        .ok_or_else(|| "No home folder.".to_string())
}

/// The voice for a language tag ("nl", "nl-NL", "nl_BE").
fn voice_for(lang: &str) -> Option<&'static (&'static str, &'static str, &'static str)> {
    let base = lang
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    VOICES.iter().find(|(l, _, _)| *l == base)
}

/// A voice's folder once installed: the model, tokens and espeak data.
fn voice_files(voice: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let dir = voices_dir().ok()?.join(format!("vits-piper-{voice}"));
    let model = dir.join(format!("{voice}.onnx"));
    let tokens = dir.join("tokens.txt");
    let data = dir.join("espeak-ng-data");
    (model.is_file() && tokens.is_file() && data.is_dir()).then_some((model, tokens, data))
}

/// The languages lessons can be read in, and which are installed.
#[tauri::command]
pub fn lesson_voices() -> Vec<LessonVoice> {
    VOICES
        .iter()
        .map(|(lang, voice, label)| LessonVoice {
            lang,
            label,
            voice,
            installed: voice_files(voice).is_some(),
        })
        .collect()
}

/// Download and unpack the voice for a language (about 65 MB), reporting
/// progress as `lesson-voice-progress` events.
#[tauri::command]
pub async fn lesson_voice_install(
    app: AppHandle,
    state: State<'_, AppState>,
    lang: String,
) -> Result<(), String> {
    let (_, voice, label) = voice_for(&lang).ok_or("No voice for that language yet.")?;
    if voice_files(voice).is_some() {
        return Ok(());
    }
    let dir = voices_dir()?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create {}: {e}", dir.display()))?;
    let url = format!(
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-{voice}.tar.bz2"
    );
    let response = state
        .http_client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download the {label} voice: {e}"))?;
    let archive = dir.join(format!("{voice}.tar.bz2.part"));
    let emit_lang = lang.clone();
    let emitter = app.clone();
    download_file(response, &archive, MAX_VOICE_BYTES, label, move |done, total| {
        let _ = emitter.emit(
            PROGRESS_EVENT,
            Progress {
                lang: emit_lang.clone(),
                done,
                total,
            },
        );
    })
    .await?;
    let (from, to) = (archive.clone(), dir.clone());
    let unpacked = tokio::task::spawn_blocking(move || extract_archive(&from, &to))
        .await
        .map_err(|e| e.to_string())?;
    let _ = tokio::fs::remove_file(&archive).await;
    unpacked?;
    voice_files(voice)
        .map(|_| ())
        .ok_or_else(|| format!("The {label} voice didn't unpack as expected."))
}

type Engines = Mutex<HashMap<&'static str, Arc<sherpa_onnx::OfflineTts>>>;

fn engine(voice: &'static str) -> Result<Arc<sherpa_onnx::OfflineTts>, String> {
    static ENGINES: OnceLock<Engines> = OnceLock::new();
    let engines = ENGINES.get_or_init(Default::default);
    if let Some(tts) = engines.lock().map_err(|e| e.to_string())?.get(voice) {
        return Ok(tts.clone());
    }
    let (model, tokens, data) = voice_files(voice).ok_or("not-installed")?;
    let path = |p: PathBuf| Some(p.to_string_lossy().into_owned());
    let mut config = sherpa_onnx::OfflineTtsConfig::default();
    config.model.vits = sherpa_onnx::OfflineTtsVitsModelConfig {
        model: path(model),
        tokens: path(tokens),
        data_dir: path(data),
        ..Default::default()
    };
    config.model.num_threads = 2;
    config.max_num_sentences = 2;
    let tts = Arc::new(
        sherpa_onnx::OfflineTts::create(&config).ok_or("The voice couldn't start.")?,
    );
    engines
        .lock()
        .map_err(|e| e.to_string())?
        .insert(voice, tts.clone());
    Ok(tts)
}

/// The installed voices, for meetings: (language, name).
pub(crate) fn installed_voices() -> Vec<(&'static str, &'static str)> {
    VOICES
        .iter()
        .filter(|(_, voice, _)| voice_files(voice).is_some())
        .map(|(lang, _, label)| (*lang, *label))
        .collect()
}

/// Sentences, for speaking a long reply a piece at a time (the first is
/// heard while the next is made).
pub(crate) fn split_sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for c in text.chars() {
        current.push(c);
        if matches!(c, '.' | '!' | '?' | '\n') && current.trim().len() > 1 {
            out.push(current.trim().to_string());
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out
}

/// `text` read in `lang`, as samples at `rate` Hz (meetings play at 24 kHz;
/// Piper voices make 22.05 kHz).
pub(crate) fn synth_at(lang: &str, text: &str, rate: u32) -> Result<Vec<f32>, String> {
    let (_, voice, _) = voice_for(lang).ok_or("no-voice")?;
    let tts = engine(voice)?;
    let audio = tts
        .generate_with_config(
            text,
            &sherpa_onnx::GenerationConfig::default(),
            None::<fn(&[f32], f32) -> bool>,
        )
        .ok_or("The voice couldn't read that.")?;
    Ok(resample(audio.samples(), audio.sample_rate().max(1) as u32, rate))
}

/// Linear resampling: plenty for speech between close rates.
fn resample(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let len = (samples.len() as u64 * to as u64 / from as u64) as usize;
    let step = from as f64 / to as f64;
    (0..len)
        .map(|i| {
            let x = i as f64 * step;
            let j = x as usize;
            let a = samples[j.min(samples.len() - 1)];
            let b = samples[(j + 1).min(samples.len() - 1)];
            a + (b - a) * (x - j as f64) as f32
        })
        .collect()
}

/// 16-bit mono WAV.
fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Read `text` in `lang` at `speed` (1 is normal; under 1 is slower), as WAV
/// bytes. Fails with "not-installed" when that language's voice isn't there.
#[tauri::command]
pub async fn lesson_speak(
    text: String,
    lang: String,
    speed: Option<f32>,
) -> Result<tauri::ipc::Response, String> {
    let (_, voice, _) = voice_for(&lang).ok_or("no-voice")?;
    let text: String = text.trim().chars().take(MAX_TEXT_CHARS).collect();
    if text.is_empty() {
        return Ok(tauri::ipc::Response::new(wav(&[], 22_050)));
    }
    let speed = speed.unwrap_or(1.0).clamp(0.4, 2.0);
    let bytes = tokio::task::spawn_blocking(move || {
        let tts = engine(voice)?;
        let config = sherpa_onnx::GenerationConfig {
            speed,
            ..Default::default()
        };
        let audio = tts
            .generate_with_config(&text, &config, None::<fn(&[f32], f32) -> bool>)
            .ok_or("The voice couldn't read that.")?;
        Ok::<_, String>(wav(audio.samples(), audio.sample_rate().max(1) as u32))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_a_voice_by_language_tag() {
        assert_eq!(voice_for("nl-NL").map(|v| v.1), Some("nl_NL-ronnie-medium"));
        assert_eq!(voice_for("nl_BE").map(|v| v.1), Some("nl_NL-ronnie-medium"));
        assert_eq!(voice_for("EN").map(|v| v.1), Some("en_US-amy-medium"));
        assert!(voice_for("xx").is_none());
    }

    #[test]
    fn splits_sentences_and_resamples() {
        assert_eq!(
            split_sentences("Hallo! Ik heet Ken. Doei"),
            vec!["Hallo!", "Ik heet Ken.", "Doei"]
        );
        assert_eq!(resample(&[0.0; 22_050], 22_050, 24_000).len(), 24_000);
        assert_eq!(resample(&[0.5, 0.5], 24_000, 24_000), vec![0.5, 0.5]);
    }

    #[test]
    fn writes_a_wav_header() {
        let bytes = wav(&[0.0, 1.0, -1.0], 22_050);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(bytes.len(), 44 + 6);
        assert_eq!(i16::from_le_bytes([bytes[46], bytes[47]]), i16::MAX);
    }
}
