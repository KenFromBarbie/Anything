/**
 * Browser-side stand-in for `electron` (contextBridge / ipcRenderer / webUtils),
 * so the UNMODIFIED preload (src/preload/index.ts) and renderer run in any
 * webview — Buzz's Tauri window or a plain browser — against the headless
 * sidecar (src/sidecar/launcher.cjs) over a loopback WebSocket.
 *
 * Connection details come from `window.__MD_SIDECAR__ = { url, token }` (set by
 * the host shell before boot) or, for dev, `?sidecarPort=&sidecarToken=`.
 *
 * Host capabilities the sidecar can't do itself (file pickers, opening URLs,
 * OS notifications) arrive as `call` messages; the host registers handlers
 * with setHostHandler(). Browser fallbacks are provided for dev.
 */

type Listener = (event: { sender: typeof ipcRenderer }, ...args: unknown[]) => void;
type HostHandler = (...args: any[]) => unknown;

interface Welcome { windowId: number; version: string; platform: string; arch: string }

declare global {
  interface Window { __MD_SIDECAR__?: { url: string; token: string } }
}

// ─── wire format (mirror of src/sidecar/wire.cjs) ────────────────────────────
function toB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
function encode(msg: unknown): string {
  return JSON.stringify(msg, function (this: any, key, value) {
    const raw = this[key];
    if (raw instanceof ArrayBuffer) return { __u8: toB64(new Uint8Array(raw)) };
    if (ArrayBuffer.isView(raw)) return { __u8: toB64(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) };
    if (raw instanceof Date) return { __date: raw.toISOString() };
    if (raw === undefined && Array.isArray(this)) return { __undef: 1 };
    return value;
  });
}
function decode(text: string): any {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object') {
      if (typeof v.__u8 === 'string') return fromB64(v.__u8);
      if (typeof v.__date === 'string') return new Date(v.__date);
      if (v.__undef === 1) return undefined;
    }
    return v;
  });
}

// ─── connection ──────────────────────────────────────────────────────────────
function endpoint(): string {
  const injected = window.__MD_SIDECAR__;
  if (injected) return `${injected.url}?token=${encodeURIComponent(injected.token)}`;
  // Hosted in Buzz's Office iframe: details ride in the fragment, which never
  // leaves the webview (not sent to any server, not in request logs).
  const h = new URLSearchParams(location.hash.slice(1));
  const hashUrl = h.get('sidecarUrl');
  const hashToken = h.get('sidecarToken');
  if (hashUrl && hashToken && /^ws:\/\/127\.0\.0\.1:\d+\/$/.test(hashUrl)) {
    return `${hashUrl}?token=${encodeURIComponent(hashToken)}`;
  }
  const q = new URLSearchParams(location.search);
  const port = q.get('sidecarPort');
  const token = q.get('sidecarToken');
  if (!port || !token) throw new Error('[office] no sidecar connection details (window.__MD_SIDECAR__ or ?sidecarPort=&sidecarToken=)');
  return `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
}

let ws: WebSocket | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; ch: string }>();
const outbox: string[] = [];
const listeners = new Map<string, Set<Listener>>();
const syncCache = new Map<string, unknown>();
const hostHandlers = new Map<string, HostHandler>();
let welcome: Welcome | null = null;
let resolveReady!: (w: Welcome) => void;
const welcomed = new Promise<Welcome>((r) => { resolveReady = r; });

function post(msg: unknown): void {
  const text = encode(msg);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
  else outbox.push(text);
}

function connect(attempt = 0): void {
  const sock = new WebSocket(endpoint());
  ws = sock;
  sock.onopen = () => {
    attempt = 0;
    sock.send(encode({ t: 'hello' }));
    for (const text of outbox.splice(0)) sock.send(text);
  };
  sock.onmessage = (e) => { void onMessage(decode(String(e.data))); };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    for (const [, p] of pending) p.reject(new Error(`Error invoking remote method '${p.ch}': sidecar connection lost`));
    pending.clear();
    const delay = Math.min(250 * 2 ** attempt, 5000);
    setTimeout(() => connect(attempt + 1), delay);
  };
}

async function onMessage(m: any): Promise<void> {
  switch (m.t) {
    case 'welcome':
      welcome = { windowId: m.windowId, version: m.version, platform: m.platform, arch: m.arch };
      resolveReady(welcome);
      return;
    case 'result': {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(`Error invoking remote method '${p.ch}': Error: ${m.error?.message ?? 'unknown error'}`));
      return;
    }
    case 'event': {
      const set = listeners.get(m.ch);
      if (!set) return;
      const evt = { sender: ipcRenderer };
      for (const fn of [...set]) {
        try { fn(evt, ...(m.args ?? [])); } catch (err) { console.error(`[office] listener for '${m.ch}' threw`, err); }
      }
      return;
    }
    case 'call': {
      const fn = hostHandlers.get(m.op);
      try {
        const value = fn ? await fn(...(m.args ?? [])) : undefined;
        post({ t: 'callResult', id: m.id, ok: true, value });
      } catch (err: any) {
        post({ t: 'callResult', id: m.id, ok: false, error: { message: err?.message ?? String(err) } });
      }
      return;
    }
  }
}

function request(t: 'invoke' | 'sync', ch: string, args: unknown[]): Promise<unknown> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, ch });
    post({ t, id, ch, args });
  });
}

// ─── the electron surface the preload uses ───────────────────────────────────
export const ipcRenderer = {
  invoke: (ch: string, ...args: unknown[]) => request('invoke', ch, args),
  send: (ch: string, ...args: unknown[]) => post({ t: 'send', ch, args }),
  /** Sync IPC can't cross a socket. Answer from a cache primed at boot and
   *  refresh it in the background on every read. */
  sendSync: (ch: string, ...args: unknown[]) => {
    const key = ch + JSON.stringify(args);
    void request('sync', ch, args).then((v) => syncCache.set(key, v), () => {});
    return syncCache.get(key);
  },
  on(ch: string, fn: Listener) {
    let set = listeners.get(ch);
    if (!set) listeners.set(ch, (set = new Set()));
    set.add(fn);
    return ipcRenderer;
  },
  once(ch: string, fn: Listener) {
    const wrap: Listener = (e, ...a) => { ipcRenderer.removeListener(ch, wrap); fn(e, ...a); };
    return ipcRenderer.on(ch, wrap);
  },
  removeListener(ch: string, fn: Listener) {
    listeners.get(ch)?.delete(fn);
    return ipcRenderer;
  },
  off(ch: string, fn: Listener) { return ipcRenderer.removeListener(ch, fn); },
  removeAllListeners(ch?: string) {
    if (ch) listeners.delete(ch); else listeners.clear();
    return ipcRenderer;
  }
};

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown) { (window as any)[key] = api; }
};

export const webUtils = {
  // Tauri drag-drop delivers real paths separately; browsers never expose them.
  getPathForFile: (file: File) => (file as any).path ?? ''
};

export type IpcRendererEvent = { sender: typeof ipcRenderer };

// ─── host capabilities ───────────────────────────────────────────────────────
export function setHostHandler(op: string, fn: HostHandler): void { hostHandlers.set(op, fn); }

// Plain-browser fallbacks; the Tauri shell replaces these with native ones.
setHostHandler('shell.openExternal', (url: string) => {
  if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
});
setHostHandler('shell.openPath', () => 'Opening local paths needs the desktop shell');
setHostHandler('shell.showItemInFolder', () => undefined);
setHostHandler('dialog.showOpenDialog', (opts: { title?: string; properties?: string[] }) => {
  const p = window.prompt(opts?.title ?? 'Path', '');
  return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
});
setHostHandler('dialog.showMessageBox', (opts: { message?: string; buttons?: string[]; cancelId?: number }) => {
  const ok = window.confirm(opts?.message ?? '');
  return { response: ok ? 0 : (opts?.cancelId ?? 1) };
});
setHostHandler('dialog.showErrorBox', (title: string, content: string) => { window.alert(`${title}\n\n${content}`); });
setHostHandler('notification.show', async ({ title, body }: { title: string; body: string }) => {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return false;
  return new Promise<boolean>((resolve) => {
    const n = new Notification(title, { body });
    n.onclick = () => resolve(true);
    n.onclose = () => resolve(false);
  });
});

// Embedded in a host page (Buzz's Office iframe): the host performs native
// capabilities via its own APIs. Forward every host op to it over postMessage,
// same-origin only, and accept answers only from the parent window.
const HOST_OPS = [
  'shell.openExternal', 'shell.openPath', 'shell.showItemInFolder',
  'dialog.showOpenDialog', 'dialog.showSaveDialog', 'dialog.showMessageBox', 'dialog.showErrorBox',
  'notification.show'
];

if (window.parent !== window) {
  let hostSeq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const m = event.data;
    if (m?.source !== 'buzz-office-host' || m.type !== 'host-result') return;
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m.value); else w.reject(new Error(m.error?.message ?? 'host call failed'));
  });
  for (const op of HOST_OPS) {
    setHostHandler(op, (...args: unknown[]) => new Promise((resolve, reject) => {
      const id = ++hostSeq;
      waiting.set(id, { resolve, reject });
      window.parent.postMessage({ source: 'buzz-office', type: 'host-call', id, op, args }, location.origin);
    }));
  }
}

/** Connect, learn the sidecar's platform (the preload reads process.platform),
 *  and prime the sync-IPC cache. Await before importing the preload. */
export async function connectSidecar(): Promise<Welcome> {
  connect();
  const w = await welcomed;
  (globalThis as any).process ??= { platform: w.platform, arch: w.arch, env: {}, versions: {} };
  await Promise.all(
    ['roster:readSync', 'config:homeSync', 'app:readClipboardSync'].map((ch) =>
      request('sync', ch, []).then((v) => syncCache.set(ch + '[]', v), () => {}))
  );
  return w;
}

export default { ipcRenderer, contextBridge, webUtils };
