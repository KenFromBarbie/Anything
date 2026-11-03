import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** A language lessons can be read in by the app's own voice. */
export type LessonVoice = {
  lang: string;
  label: string;
  voice: string;
  installed: boolean;
};

export const lessonVoices = () => invoke<LessonVoice[]>("lesson_voices");

/** Download a language's voice (about 65 MB); `onProgress` gets 0..1. */
export async function installLessonVoice(
  lang: string,
  onProgress?: (share: number) => void,
): Promise<void> {
  const off = await listen<{
    lang: string;
    done: number;
    total: number | null;
  }>("lesson-voice-progress", ({ payload }) => {
    if (payload.lang === lang && payload.total)
      onProgress?.(payload.done / payload.total);
  });
  try {
    await invoke("lesson_voice_install", { lang });
  } finally {
    off();
  }
}

let playing: { audio: HTMLAudioElement; url: string; done: () => void } | null =
  null;

/** Stop whatever the app's voice is reading. */
export function stopSpeaking() {
  if (!playing) return;
  playing.audio.pause();
  URL.revokeObjectURL(playing.url);
  playing.done();
  playing = null;
}

/** Read `text` aloud in `lang` with the app's voice; resolves when it's done.
 *  Rejects with "not-installed" when that language's voice isn't there yet,
 *  and "no-voice" for a language the app has no voice for. */
export async function speak(
  text: string,
  lang: string,
  rate = 1,
): Promise<void> {
  stopSpeaking();
  const bytes = await invoke<ArrayBuffer>("lesson_speak", {
    text,
    lang,
    speed: rate,
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  await new Promise<void>((resolve, reject) => {
    const done = () => resolve();
    playing = { audio, url, done };
    audio.onended = () => {
      if (playing?.audio === audio) {
        URL.revokeObjectURL(url);
        playing = null;
      }
      resolve();
    };
    audio.onerror = () => reject(new Error("The voice couldn't play."));
    void audio.play().catch(reject);
  });
}

/**
 * Put into every agent-made page: its `speechSynthesis` asks the app to read
 * instead of the computer's voices (which often lack the language), so a
 * lesson that uses the browser's speech gets the app's voice unchanged.
 */
export const SPEECH_SHIM = `<script>(() => {
  const langs = ["nl-NL", "en-US", "de-DE", "fr-FR", "es-ES"];
  const voices = langs.map((lang) => ({ name: "Anything (" + lang + ")", lang, voiceURI: "anything:" + lang, localService: true, default: lang === "en-US" }));
  const fire = (target, type, extra) => {
    const event = Object.assign(new Event(type), extra || {});
    try { target["on" + type] && target["on" + type](event); } catch (e) { console.error(e); }
    (target.__listeners && target.__listeners[type] || []).forEach((fn) => { try { fn(event); } catch (e) { console.error(e); } });
  };
  const listenable = (o) => Object.assign(o, {
    addEventListener(type, fn) { (this.__listeners = this.__listeners || {}); (this.__listeners[type] = this.__listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { const l = this.__listeners && this.__listeners[type]; if (l) l.splice(l.indexOf(fn) >>> 0, 1); }
  });
  class Utterance { constructor(text) { this.text = text || ""; this.lang = ""; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; listenable(this); } }
  let next = 0; const pending = new Map();
  const synth = listenable({
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices: () => voices.slice(),
    speak(u) {
      const id = ++next; pending.set(id, u); synth.speaking = true;
      const lang = u.lang || (u.voice && u.voice.lang) || document.documentElement.lang || "en";
      parent.postMessage({ type: "buzz-speak", id, text: String(u.text || ""), lang, rate: Number(u.rate) || 1 }, "*");
      setTimeout(() => fire(u, "start"), 0);
    },
    cancel() { parent.postMessage({ type: "buzz-speak-stop" }, "*"); const all = [...pending.values()]; pending.clear(); synth.speaking = false; all.forEach((u) => fire(u, "end")); },
    pause() {}, resume() {}
  });
  addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "buzz-spoken") return;
    const u = pending.get(d.id); pending.delete(d.id); synth.speaking = pending.size > 0;
    if (u) d.error ? fire(u, "error", { error: d.error }) : fire(u, "end");
  });
  try {
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true, writable: true });
  } catch (e) { console.error(e); }
  setTimeout(() => fire(synth, "voiceschanged"), 0);
})();</script>`;
