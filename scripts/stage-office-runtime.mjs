#!/usr/bin/env node
// Stage the Office runtime that installers ship as `resources/office`.
//
// The desktop app runs the Office as a sidecar: office/src/sidecar/launcher.cjs
// (headless: electron-shim.cjs stands in for Electron), which loads the built
// main process from office/out. An installed app needs the Office's built
// code, its resources, its production node_modules, and a runtime to run
// them: plain Node — the Node running this script, copied to
// runtime/node(.exe) — with the native modules (node-pty, better-sqlite3)
// rebuilt for it. (Development runs Electron in Node mode instead, with the
// modules the Office's postinstall built for Electron; shipping Electron
// would mean a whole browser just to run Node.)
//
// Run after `npm ci` and `npm run build` in office/, with the Node the app
// should ship. Writes desktop/src-tauri/office-runtime/ (git-ignored), which
// desktop/src-tauri/tauri.release.conf.json bundles.

import { execSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
need(join(office, "node_modules", "node-pty"), "run `npm ci` in office/");
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

// Production modules: the installed tree (with the Office's patches), less
// dev-only packages (Electron among them), then the native modules rebuilt
// for this Node.
console.log("stage-office-runtime: copying node_modules…");
copy("node_modules");
execSync("npm prune --omit=dev --ignore-scripts --no-audit --no-fund", {
  cwd: out,
  stdio: "inherit",
});
rmSync(join(out, "node_modules", "electron"), { recursive: true, force: true });
console.log(`stage-office-runtime: native modules for Node ${process.version}…`);
execSync("npm rebuild better-sqlite3 node-pty --no-audit --no-fund", {
  cwd: out,
  stdio: "inherit",
});

// ─── Only what the main process uses ────────────────────────────────────────
// The Office's dependencies are mostly its UI's (editors, terminals, React),
// which the app serves prebuilt. Keep the packages the main process and the
// sidecar actually require, with their own dependencies, and nothing else.
const pkg = JSON.parse(readFileSync(join(office, "package.json"), "utf8"));
const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(c?js|mjs)$/.test(entry.name)) sources.push(path);
  }
};
for (const dir of [join(out, "out", "main"), join(out, "src"), join(out, "resources")]) {
  if (existsSync(dir)) walk(dir);
}
const code = sources.map((file) => readFileSync(file, "utf8")).join("\n");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const roots = Object.keys(pkg.dependencies ?? {}).filter((name) =>
  new RegExp(`(require\\(|from |import\\()["']${escape(name)}(["'/])`).test(code),
);
const keep = new Set();
const visit = (name) => {
  if (keep.has(name)) return;
  const manifest = join(out, "node_modules", name, "package.json");
  if (!existsSync(manifest)) return;
  keep.add(name);
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  for (const dep of Object.keys({ ...m.dependencies, ...m.optionalDependencies })) visit(dep);
};
roots.forEach(visit);
for (const entry of readdirSync(join(out, "node_modules"))) {
  if (entry.startsWith(".")) continue;
  const names = entry.startsWith("@")
    ? readdirSync(join(out, "node_modules", entry)).map((n) => `${entry}/${n}`)
    : [entry];
  for (const name of names) {
    if (!keep.has(name)) rmSync(join(out, "node_modules", name), { recursive: true, force: true });
  }
  if (entry.startsWith("@") && readdirSync(join(out, "node_modules", entry)).length === 0) {
    rmSync(join(out, "node_modules", entry), { recursive: true, force: true });
  }
}
rmSync(join(out, "node_modules", ".bin"), { recursive: true, force: true });
console.log(`stage-office-runtime: kept ${keep.size} packages for ${roots.join(", ")}`);

// ─── Native modules: just this platform's binaries ──────────────────────────
// Their builds leave sources, symbols and intermediates behind, and node-pty
// carries prebuilt copies for other platforms too.
const binary = /\.(node|dll|dylib|so|exe)$|^spawn-helper$/;
const prune = (dir, keepFile) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      prune(path, keepFile);
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true, force: true });
    } else if (!keepFile(entry.name)) {
      rmSync(path, { force: true });
    }
  }
};
for (const name of ["node-pty", "better-sqlite3"]) {
  const mod = join(out, "node_modules", name);
  for (const dir of ["deps", "src", "third_party", "scripts", "node-addon-api", "typings"]) {
    rmSync(join(mod, dir), { recursive: true, force: true });
  }
  prune(join(mod, "build"), (file) => binary.test(file) && !/^test_/.test(file));
  // A built copy is loaded first; prebuilt ones are only a fallback.
  const built = existsSync(join(mod, "build", "Release"));
  const prebuilds = join(mod, "prebuilds");
  if (existsSync(prebuilds)) {
    for (const target of readdirSync(prebuilds)) {
      if (built || target !== `${process.platform}-${process.arch}`) {
        rmSync(join(prebuilds, target), { recursive: true, force: true });
      }
    }
  }
}

// The runtime: this Node.
const node = process.platform === "win32" ? "node.exe" : "node";
mkdirSync(join(out, "runtime"), { recursive: true });
copyFileSync(process.execPath, join(out, "runtime", node));
if (process.platform !== "win32") chmodSync(join(out, "runtime", node), 0o755);

// It must load what it ships.
execSync(
  `"${join(out, "runtime", node)}" -e "require('better-sqlite3')(':memory:').prepare('select 1').get(); require('node-pty'); console.log('stage-office-runtime: natives load in', process.version)"`,
  { cwd: out, stdio: "inherit" },
);

// It must start: the Office reports ready (in a throwaway data folder).
const scratch = mkdtempSync(join(tmpdir(), "office-check-"));
const started = spawnSync(
  join(out, "runtime", node),
  [
    "-e",
    `const { spawn } = require("node:child_process");
     const child = spawn(process.execPath, ["src/sidecar/launcher.cjs"], {
       cwd: ${JSON.stringify(out)},
       env: { ...process.env, MD_USER_DATA: ${JSON.stringify(scratch)}, MD_APP_PATH: ${JSON.stringify(out)} },
     });
     let seen = "";
     const done = (ok) => { child.kill(); process.exit(ok ? 0 : 1); };
     child.stdout.on("data", (d) => { seen += d; if (seen.includes("MD_SIDECAR_READY")) done(true); });
     child.stderr.on("data", (d) => process.stderr.write(d));
     child.on("exit", () => done(false));
     setTimeout(() => done(false), 60000);`,
  ],
  { stdio: "inherit" },
);
rmSync(scratch, { recursive: true, force: true });
if (started.status !== 0) {
  console.error("stage-office-runtime: the staged Office didn't start");
  process.exit(1);
}
console.log("stage-office-runtime: the staged Office starts");
console.log(`stage-office-runtime: staged ${out}`);
