import { invoke } from "@tauri-apps/api/core";

import { isPureCacheKey } from "@/shared/lib/localStorageQuota";

/**
 * Keeps a copy of the load-bearing localStorage on disk (Rust:
 * `local_state_backup`) and puts it back when the webview comes up with its
 * storage wiped. That happened once after a forced quit: the identity was
 * intact, but the servers list and "setup done" markers were gone, so the app
 * showed the first-run screen. Caches (channel snapshots, skeletons) are left
 * out; they repaint from the relays.
 */

/** Present on any machine that has finished setup: its absence means wiped. */
const SETUP_MARKERS = ["buzz-communities", "buzz-machine-onboarding-complete"];
const SAVE_EVERY_MS = 60_000;

function isWiped(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && SETUP_MARKERS.some((marker) => key.startsWith(marker))) {
      return false;
    }
  }
  return true;
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || isPureCacheKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** Who the copy belongs to: restored only for the same identity, so a
 *  deliberate identity reset (which wipes storage on purpose) stays reset. */
const OWNER_KEY = "__anything.backup-owner";

async function currentPubkey(): Promise<string | null> {
  try {
    const raw = await invoke<{ pubkey?: string }>("get_identity");
    return typeof raw?.pubkey === "string" ? raw.pubkey : null;
  } catch {
    return null;
  }
}

/** Before the app reads storage: restore the copy if storage was wiped. */
export async function restoreLocalStateIfWiped(): Promise<boolean> {
  try {
    if (!isWiped()) return false;
    const json = await invoke<string | null>("local_state_backup_load");
    if (!json) return false;
    const saved = JSON.parse(json) as Record<string, string>;
    const owner = saved[OWNER_KEY];
    delete saved[OWNER_KEY];
    if (!owner || owner !== (await currentPubkey())) return false;
    if (
      !SETUP_MARKERS.some((m) =>
        Object.keys(saved).some((k) => k.startsWith(m)),
      )
    ) {
      return false;
    }
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value === "string") localStorage.setItem(key, value);
    }
    console.warn(
      `[localStateBackup] storage was empty; restored ${Object.keys(saved).length} entries from the on-disk copy`,
    );
    return true;
  } catch (error) {
    console.warn("[localStateBackup] restore failed:", error);
    return false;
  }
}

let lastSaved = "";
let owner: string | null = null;

function save(): void {
  // Never overwrite a good copy with a wiped store.
  if (isWiped() || !owner) return;
  const json = JSON.stringify({ ...snapshot(), [OWNER_KEY]: owner });
  if (json === lastSaved) return;
  lastSaved = json;
  void invoke("local_state_backup_save", { json }).catch((error) => {
    lastSaved = "";
    console.warn("[localStateBackup] save failed:", error);
  });
}

/** Keep the on-disk copy current: every minute, and when the window hides. */
export function startLocalStateBackup(): void {
  void currentPubkey().then((pubkey) => {
    owner = pubkey;
    save();
  });
  window.setInterval(save, SAVE_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
  window.addEventListener("beforeunload", save);
}
