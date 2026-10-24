import * as React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * What the owner calls the app (it's "Anything" until they name it — first
 * run asks, Settings → Appearance changes it), and what they call
 * themselves: the display name new communities get, instead of a shortened
 * key.
 */

export const DEFAULT_APP_NAME = "Anything";
export const APP_NAME_STORAGE_KEY = "anything.app-name";
export const OWNER_NAME_STORAGE_KEY = "anything.owner-name";
const MAX_NAME_LENGTH = 40;

const listeners = new Set<() => void>();

function read(key: string): string {
  try {
    return globalThis.localStorage?.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    if (value) globalThis.localStorage?.setItem(key, value);
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // Persistence is best-effort; the in-memory name still applies.
  }
}

export function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

let appName = read(APP_NAME_STORAGE_KEY) || DEFAULT_APP_NAME;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAppName(): string {
  return appName;
}

export function setAppName(name: string): void {
  const cleaned = cleanName(name);
  appName = cleaned || DEFAULT_APP_NAME;
  write(APP_NAME_STORAGE_KEY, cleaned === DEFAULT_APP_NAME ? "" : cleaned);
  applyAppName();
  for (const listener of listeners) listener();
}

export function useAppName(): string {
  return React.useSyncExternalStore(
    subscribe,
    getAppName,
    () => DEFAULT_APP_NAME,
  );
}

/** The window's title follows the app's name. */
export function applyAppName(): void {
  document.title = appName;
  try {
    void getCurrentWindow()
      .setTitle(appName)
      .catch(() => {});
  } catch {
    // Not in the app's window (tests, a plain browser).
  }
}

export function getOwnerName(): string {
  return read(OWNER_NAME_STORAGE_KEY);
}

export function setOwnerName(name: string): void {
  write(OWNER_NAME_STORAGE_KEY, cleanName(name));
}
