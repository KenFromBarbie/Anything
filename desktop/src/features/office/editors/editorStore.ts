import * as React from "react";
import { invoke } from "@tauri-apps/api/core";

import { type EditorFile, type EditorKind, fileName } from "./formats";

/** What the editor window has open. */
export type OpenEditor = {
  kind: EditorKind;
  title: string;
  file: EditorFile | null;
  /** The saved thing it continues (its first version's id), if any. */
  series?: string;
  /** The version it was opened from, if any. */
  artifactId?: string;
  path?: string;
};

let current: OpenEditor | null = null;
const listeners = new Set<() => void>();

export function openEditor(next: OpenEditor) {
  current = next;
  for (const l of listeners) l();
}

export function closeEditor() {
  current = null;
  for (const l of listeners) l();
}

export function useOpenEditor(): OpenEditor | null {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

type Saved = { id: string; series?: string; path?: string };

/** Save to Create. The first save makes a new item; later saves are its
 *  next versions. */
export async function saveToCreate(
  kind: EditorKind,
  title: string,
  file: EditorFile,
  series?: string,
): Promise<{ id: string; series: string; path?: string }> {
  const saved = await invoke<Saved>("office_artifact_save_file", {
    title: title.trim() || "Untitled",
    fileName: fileName(title, kind),
    text: JSON.stringify(file),
    series: series ?? null,
  });
  return { id: saved.id, series: saved.series ?? saved.id, path: saved.path };
}

/** Save a file where the owner picks (an export). */
export async function exportFile(
  defaultName: string,
  text: string,
  ext: string,
  label: string,
  /** `text` is base64 (or a data: URL) of a binary file. */
  binary = false,
) {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] });
  if (typeof path !== "string") return false;
  await invoke("office_export_file", { path, text, base64: binary });
  return true;
}
