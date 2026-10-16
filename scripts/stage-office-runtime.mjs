#!/usr/bin/env node
// Stage the Office runtime that installers ship as `resources/office`.
//
// The desktop app runs the Office as a sidecar: Electron in Node mode
// (ELECTRON_RUN_AS_NODE) executing office/src/sidecar/launcher.cjs, which
// loads the built main process from office/out. So an installed app needs
// the Office's built code, its resources, and its production node_modules,
// including Electron itself and the native modules (node-pty,
// better-sqlite3) already rebuilt for Electron by the Office's postinstall.
//
// Run after `npm ci` and `npm run build` in office/. Writes
// desktop/src-tauri/office-runtime/ (git-ignored), which
// desktop/src-tauri/tauri.release.conf.json bundles.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const office = join(root, "office");
const out = join(root, "desktop", "src-tauri", "office-runtime");

function need(path, hint) {
  if (!existsSync(path)) {
    console.error(`stage-office-runtime: missing ${path} (${hint})`);
    process.exit(1);
  }
}
need(join(office, "node_modules", "electron", "dist"), "run `npm ci` in office/");
need(join(office, "out", "main"), "run `npm run build` in office/");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (rel, filter) => {
  const from = join(office, rel);
  if (existsSync(from)) {
    cpSync(from, join(out, rel), { recursive: true, filter, verbatimSymlinks: true });
  }
};

for (const file of [
  "package.json",
  "package-lock.json",
  "CHANGELOG.md",
  "LICENSE",
  "LICENSE-ASSETS",
]) {
  copy(file);
}
// The main process; the UI is served by the desktop app (public/office-app).
copy("out", (src) => !src.includes(`${join("out", "sidecar-web")}`));
copy("resources");
copy(join("src", "sidecar"));
// CommonJS helpers the main process loads from source at runtime.
mkdirSync(join(out, "src", "main"), { recursive: true });
for (const name of readdirSync(join(office, "src", "main"))) {
  if (name.endsWith(".cjs")) copy(join("src", "main", name));
}

// Production modules: copy the installed tree (natives already built for
// Electron), drop dev-only packages, then put Electron back (it is a dev
// dependency of the Office, but it is the runtime here).
console.log("stage-office-runtime: copying node_modules…");
copy("node_modules");
execSync("npm prune --omit=dev --ignore-scripts --no-audit --no-fund", {
  cwd: out,
  stdio: "inherit",
});
// The app starts node_modules/electron/dist's binary directly, so the
// package's own (install-time) dependencies aren't needed.
copy(join("node_modules", "electron"));

console.log(`stage-office-runtime: staged ${out}`);
