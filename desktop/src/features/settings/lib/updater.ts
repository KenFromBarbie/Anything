import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Updates from the app's GitHub releases (Rust: `updater.rs`). */

export type UpdateInfo = {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  url: string;
  /** The installer that would be downloaded for this computer. */
  asset: string | null;
  size: number;
};

export type UpdaterSettings = { auto: boolean };
export type UpdateProgress = { downloaded: number; total: number };

export const checkForUpdate = () => invoke<UpdateInfo>("updater_check");
/** Downloads and installs the latest release; the app restarts into it. */
export const installUpdate = () => invoke<void>("updater_install");
export const getUpdaterSettings = () =>
  invoke<UpdaterSettings>("updater_settings_get");
export const setAutoUpdate = (auto: boolean) =>
  invoke<UpdaterSettings>("updater_settings_set", { auto });

export const onUpdateProgress = (handler: (p: UpdateProgress) => void) =>
  listen<UpdateProgress>("updater-progress", (event) => handler(event.payload));

export function formatMegabytes(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / 1_048_576))} MB`;
}
