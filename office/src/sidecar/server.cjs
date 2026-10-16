'use strict';
/**
 * Loopback WebSocket server that stands in for Electron's IPC pipe.
 *
 * Security: binds 127.0.0.1 only, and every connection must present the
 * per-launch token (?token=...) the shell received on our stdout. The token is
 * compared in constant time and never logged.
 */
const crypto = require('node:crypto');
const WebSocket = require('ws');
const shim = require('./electron-shim.cjs');
const { encode, decode } = require('./wire.cjs');

const HOST_CALL_TIMEOUT_MS = 5 * 60 * 1000; // file pickers can sit open a while

function tokenOk(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class Client {
  constructor(ws) {
    this.ws = ws;
    this.wc = null;
    this.pending = new Map(); // host-call id -> { resolve, reject, timer }
    this.seq = 0;
  }
  post(msg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg)); }
  sendEvent(ch, args) { this.post({ t: 'event', ch, args }); }
  call(op, args) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`host call '${op}' timed out`)); }, HOST_CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ t: 'call', id, op, args });
    });
  }
  settle(id, ok, value, error) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    ok ? p.resolve(value) : p.reject(new Error(error?.message ?? 'host call failed'));
  }
  dispose() {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.resolve(undefined); }
    this.pending.clear();
    if (this.wc) this.wc._detach(this);
  }
}

const clients = new Set();
const waitingForWindow = []; // clients that said hello before any window existed

function pickWindow() {
  const all = shim.BrowserWindow.getAllWindows();
  return all.find((w) => !w.webContents._client) ?? all[0] ?? null;
}

function attach(client, win) {
  const wc = win.webContents;
  if (wc._client && wc._client !== client) wc._client.wc = null; // a reload replaces the old socket
  client.wc = wc;
  // A fresh UI is a fresh page load as far as index.ts is concerned.
  wc.emit('did-start-navigation', { isMainFrame: true, url: wc.getURL() });
  client.post({ t: 'welcome', windowId: win.id, version: shim.app.getVersion(), platform: process.platform, arch: process.arch });
  wc._attach(client);
  wc.emit('did-finish-load');
}

shim.__bridge.onWindowCreated = (win) => {
  const c = waitingForWindow.shift();
  if (c) setImmediate(() => attach(c, win));
};

shim.__bridge.hostCall = async (op, args) => {
  // Prefer the client attached to the most recently created live window.
  const live = [...clients].filter((c) => c.wc && !c.wc.isDestroyed());
  const target = live[live.length - 1];
  if (!target) return undefined;
  return target.call(op, args);
};

function errPayload(e) {
  return { message: e && e.message ? e.message : String(e), name: e && e.name ? e.name : 'Error' };
}

async function onMessage(client, raw) {
  let msg;
  try { msg = decode(raw.toString()); } catch { return; }
  const evt = () => ({
    sender: client.wc,
    senderFrame: { url: client.wc ? client.wc.getURL() : '' },
    processId: 0,
    frameId: 0,
    reply: (ch, ...args) => client.sendEvent(ch, args)
  });

  switch (msg.t) {
    case 'hello': {
      const win = pickWindow();
      if (win) attach(client, win);
      else waitingForWindow.push(client);
      return;
    }
    case 'invoke': {
      const fn = shim.ipcMain.handlers.get(msg.ch);
      if (!fn) {
        client.post({ t: 'result', id: msg.id, ok: false, error: { message: `No handler registered for '${msg.ch}'` } });
        return;
      }
      try {
        const value = await fn(evt(), ...(msg.args ?? []));
        client.post({ t: 'result', id: msg.id, ok: true, value });
      } catch (e) {
        client.post({ t: 'result', id: msg.id, ok: false, error: errPayload(e) });
      }
      return;
    }
    case 'send':
      shim.ipcMain.emit(msg.ch, evt(), ...(msg.args ?? []));
      return;
    case 'sync': {
      const e = evt();
      try {
        shim.ipcMain.emit(msg.ch, e, ...(msg.args ?? []));
        client.post({ t: 'result', id: msg.id, ok: true, value: e.returnValue });
      } catch (err) {
        client.post({ t: 'result', id: msg.id, ok: false, error: errPayload(err) });
      }
      return;
    }
    case 'callResult':
      client.settle(msg.id, msg.ok, msg.value, msg.error);
      return;
    case 'shutdown':
      // Only the shell sends this (it holds the same token as any UI client).
      // Windows has no graceful SIGTERM for child processes, so this message
      // is the shell's clean-stop path.
      hooks.onShutdown('shutdown message');
      return;
  }
}

const hooks = { onShutdown: (_reason) => {} };

/** Start listening. Resolves with the bound port and the connection token. */
function start({ port = 0, token = crypto.randomBytes(24).toString('base64url') } = {}) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocket.Server({
      host: '127.0.0.1',
      port,
      maxPayload: 64 * 1024 * 1024,
      verifyClient: (info, done) => {
        const url = new URL(info.req.url, 'ws://127.0.0.1');
        if (!tokenOk(url.searchParams.get('token'), token)) return done(false, 401, 'Unauthorized');
        done(true);
      }
    });
    wss.on('error', reject);
    wss.on('listening', () => resolve({ port: wss.address().port, token, wss }));
    wss.on('connection', (ws) => {
      const client = new Client(ws);
      clients.add(client);
      ws.on('message', (raw) => { void onMessage(client, raw); });
      ws.on('close', () => {
        clients.delete(client);
        const i = waitingForWindow.indexOf(client);
        if (i >= 0) waitingForWindow.splice(i, 1);
        client.dispose();
      });
    });
  });
}

module.exports = { start, hooks };
