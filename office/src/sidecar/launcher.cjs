'use strict';
/**
 * Entry point for running Munder Difflin's main process headless.
 *
 *   ELECTRON_RUN_AS_NODE=1 electron.exe src/sidecar/launcher.cjs
 *
 * (Electron-as-Node so the Electron-ABI native modules — node-pty,
 * better-sqlite3 — load unchanged. Plain Node works too once those are
 * rebuilt for Node's ABI.)
 *
 * Env:
 *   MD_SIDECAR_PORT   port to bind on 127.0.0.1 (default: random)
 *   MD_SIDECAR_TOKEN  connection token (default: random, printed once)
 *   MD_USER_DATA      data dir (default %APPDATA%/buzz-office)
 *   MD_MASTER_KEY     32-byte base64 key for secret storage, from the shell
 *   MD_MAIN_ENTRY     main bundle (default ../../out/main/index.js)
 *
 * Prints exactly one line the shell parses:
 *   MD_SIDECAR_READY {"port":1234,"token":"..."}
 */
const Module = require('node:module');
const { resolve } = require('node:path');

const shim = require('./electron-shim.cjs');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return shim;
  return origLoad.call(this, request, parent, isMain);
};

process.env.MD_APP_PATH ??= resolve(__dirname, '../..');

// index.ts hands its whole environment to every agent terminal it spawns. Take
// the secrets out of process.env before it loads, so no agent can read them.
// ELECTRON_RUN_AS_NODE already did its job at process start; leaving it set
// would turn any Electron app an agent launches (VS Code, …) into bare Node.
// Munder's own helper wrappers set it themselves where they need it.
const masterKeyB64 = process.env.MD_MASTER_KEY;
const fixedToken = process.env.MD_SIDECAR_TOKEN;
// Michael's Buzz-held identity (key + owner auth tag), when Buzz provides one.
const buzzAgent = process.env.BUZZ_OFFICE_AGENT_KEY
  ? { key: process.env.BUZZ_OFFICE_AGENT_KEY, authTag: process.env.BUZZ_OFFICE_AGENT_AUTH || null }
  : null;
delete process.env.MD_MASTER_KEY;
delete process.env.MD_SIDECAR_TOKEN;
delete process.env.BUZZ_OFFICE_AGENT_KEY;
delete process.env.BUZZ_OFFICE_AGENT_AUTH;
delete process.env.ELECTRON_RUN_AS_NODE;
if (masterKeyB64) shim.__setMasterKey(masterKeyB64);

let shuttingDown = false;
let buzzBridge = null;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[sidecar] shutting down (${reason})`);
  buzzBridge?.stop();
  // Destroying every window takes index.ts down its normal window-all-closed
  // path, which runs the full teardown (PTYs, proxies, helper servers).
  for (const w of shim.BrowserWindow.getAllWindows()) w.destroy();
  if (shim.BrowserWindow.getAllWindows().length === 0 && !shim.app._quitting) shim.app.emit('window-all-closed');
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Identities Buzz gives the floor's agents (one JSON line per update on our
// stdin, answering the bridge's roster report). Kept until the bridge is up.
let pendingWorkers = null;
function onShellMessage(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  // The app saw a message go out (typed, or a call transcript): look now
  // rather than at the next poll.
  if (msg?.type === 'poll-now') { buzzBridge?.pollNow(); return; }
  if (msg?.type !== 'office-agents' || !Array.isArray(msg.agents)) return;
  if (buzzBridge) void buzzBridge.setWorkers(msg.agents);
  else pendingWorkers = msg.agents;
}

// The shell holds our stdin open; if the shell dies, so do we.
if (process.env.MD_SIDECAR_STDIN_WATCH === '1') {
  let buffered = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffered += chunk;
    for (let nl = buffered.indexOf('\n'); nl >= 0; nl = buffered.indexOf('\n')) {
      onShellMessage(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
    }
  });
  process.stdin.on('end', () => shutdown('parent exited'));
  process.stdin.resume();
}

const server = require('./server.cjs');
server.hooks.onShutdown = shutdown;
server
  .start({
    port: Number(process.env.MD_SIDECAR_PORT || 0),
    ...(fixedToken ? { token: fixedToken } : {})
  })
  .then(({ port, token }) => {
    process.stdout.write(`MD_SIDECAR_READY ${JSON.stringify({ port, token })}\n`);
    require(process.env.MD_MAIN_ENTRY || resolve(__dirname, '../../out/main/index.js'));
    // Michael joins the hosting Buzz workspace (no-op unless Buzz configured it).
    require('./buzz-bridge.cjs').startBuzzBridge(shim, console, buzzAgent).then((b) => {
      if (shuttingDown) return b?.stop();
      buzzBridge = b;
      if (b && pendingWorkers) void b.setWorkers(pendingWorkers);
      pendingWorkers = null;
    });
  })
  .catch((e) => {
    console.error('[sidecar] failed to start:', e);
    process.exit(1);
  });
