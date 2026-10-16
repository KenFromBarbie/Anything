'use strict';
/**
 * Headless stand-in for the `electron` module, so Munder Difflin's main process
 * (out/main/index.js, unmodified) can run as a sidecar behind another shell
 * (the Buzz desktop app). launcher.cjs routes every require('electron') here.
 *
 * Windows become "virtual windows": each one's webContents.send() is delivered
 * to whichever UI client is attached to it over the loopback WebSocket in
 * server.cjs. Things only a real UI can do (file dialogs, opening URLs, OS
 * notifications) are forwarded to the client as host calls.
 */
const { EventEmitter } = require('node:events');
const { join } = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const env = process.env;
const pkgVersion = (() => {
  try { return JSON.parse(fs.readFileSync(join(env.MD_APP_PATH || process.cwd(), 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
})();

// ─── host bridge (filled in by server.cjs) ───────────────────────────────────
// hostCall(op, args) -> Promise<any>; fire-and-forget host ops resolve undefined
// when no UI is attached.
const bridge = {
  hostCall: async (_op, _args) => undefined,
  onWindowCreated: (_win) => {}
};

// ─── app ─────────────────────────────────────────────────────────────────────
const userData = env.MD_USER_DATA || join(env.APPDATA || join(os.homedir(), '.config'), 'buzz-office');
fs.mkdirSync(userData, { recursive: true });

const paths = {
  userData,
  appData: env.APPDATA || join(os.homedir(), '.config'),
  home: os.homedir(),
  temp: os.tmpdir(),
  logs: join(userData, 'logs'),
  desktop: join(os.homedir(), 'Desktop'),
  documents: join(os.homedir(), 'Documents'),
  downloads: join(os.homedir(), 'Downloads'),
  exe: process.execPath
};

class App extends EventEmitter {
  constructor() {
    super();
    this.isPackaged = env.MD_PACKAGED === '1';
    this._quitting = false;
  }
  getPath(name) {
    if (!(name in paths)) throw new Error(`[sidecar] app.getPath('${name}') not supported`);
    return paths[name];
  }
  setPath(name, value) { paths[name] = value; }
  getVersion() { return pkgVersion; }
  getName() { return 'Munder Difflin'; }
  getAppPath() { return env.MD_APP_PATH || process.cwd(); }
  getLocale() { return 'en-US'; }
  whenReady() { return Promise.resolve(); }
  isReady() { return true; }
  requestSingleInstanceLock() { return true; }
  setAsDefaultProtocolClient() { return false; }
  setLoginItemSettings() {}
  getLoginItemSettings() { return { openAtLogin: false, openAsHidden: false, wasOpenedAtLogin: false }; }
  relaunch() { console.log('[sidecar] app.relaunch() ignored — the shell owns the process lifecycle'); }
  focus() {}
  /** Mirrors Electron's quit sequence closely enough for index.ts: before-quit
   *  (cancellable), then will-quit (cancellable), then exit. */
  quit() {
    if (this._quitting) return;
    let prevented = false;
    const ev = { preventDefault: () => { prevented = true; } };
    this.emit('before-quit', ev);
    if (prevented) return;
    this._quitting = true;
    let willPrevented = false;
    this.emit('will-quit', { preventDefault: () => { willPrevented = true; } });
    if (!willPrevented) this.exit(0);
    // A prevented will-quit (index.ts flushes analytics) calls app.exit() itself.
  }
  exit(code = 0) {
    this.emit('quit', {}, code);
    process.exit(code);
  }
}
const app = new App();

// ─── ipcMain ─────────────────────────────────────────────────────────────────
class IpcMain extends EventEmitter {
  constructor() { super(); this.handlers = new Map(); }
  handle(ch, fn) {
    if (this.handlers.has(ch)) throw new Error(`Attempted to register a second handler for '${ch}'`);
    this.handlers.set(ch, fn);
  }
  handleOnce(ch, fn) { this.handle(ch, async (...a) => { this.handlers.delete(ch); return fn(...a); }); }
  removeHandler(ch) { this.handlers.delete(ch); }
}
const ipcMain = new IpcMain();

// ─── WebContents / BrowserWindow ─────────────────────────────────────────────
let nextId = 1;
const windows = new Set();

class Session {
  setPermissionRequestHandler(fn) { this.permissionRequestHandler = fn; }
  setPermissionCheckHandler(fn) { this.permissionCheckHandler = fn; }
  on() { return this; }
}

class WebContents extends EventEmitter {
  constructor(win) {
    super();
    this.id = nextId++;
    this._win = win;
    this._destroyed = false;
    this._client = null;      // attached UI socket (set by server.cjs)
    this._backlog = [];       // events sent while no UI is attached
    this.session = new Session();
  }
  send(ch, ...args) {
    if (this._destroyed) return;
    if (this._client) this._client.sendEvent(ch, args);
    else if (this._backlog.push({ ch, args }) > 5000) this._backlog.shift();
  }
  _attach(client) {
    this._client = client;
    const pending = this._backlog.splice(0);
    for (const e of pending) client.sendEvent(e.ch, e.args);
  }
  _detach(client) { if (this._client === client) this._client = null; }
  isDestroyed() { return this._destroyed; }
  isLoading() { return false; }
  getURL() { return 'sidecar://office'; }
  setWindowOpenHandler(fn) { this.windowOpenHandler = fn; }
  reload() {}
  focus() {}
  openDevTools() {}
  getOwnerBrowserWindow() { return this._win; }
}

class BrowserWindow extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = nextId++;
    this._opts = opts;
    this._destroyed = false;
    this._bounds = { x: opts.x ?? 0, y: opts.y ?? 0, width: opts.width ?? 1280, height: opts.height ?? 800 };
    this.webContents = new WebContents(this);
    windows.add(this);
    bridge.onWindowCreated(this);
    setImmediate(() => this.emit('ready-to-show'));
  }
  static getAllWindows() { return [...windows].filter((w) => !w._destroyed); }
  static fromWebContents(wc) { return [...windows].find((w) => w.webContents === wc) ?? null; }
  static getFocusedWindow() { return BrowserWindow.getAllWindows()[0] ?? null; }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  show() {} hide() {} focus() {} restore() {} minimize() {} maximize() {}
  isDestroyed() { return this._destroyed; }
  isMinimized() { return false; }
  isMaximized() { return false; }
  isVisible() { return true; }
  isFocused() { return true; }
  getBounds() { return { ...this._bounds }; }
  setBounds(b) { Object.assign(this._bounds, b); }
  setTitle(t) { this._opts.title = t; }
  getTitle() { return this._opts.title ?? ''; }
  flashFrame() {} setProgressBar() {} setOverlayIcon() {} setAlwaysOnTop() {} moveTop() {}
  close() {
    let prevented = false;
    this.emit('close', { preventDefault: () => { prevented = true; } });
    if (!prevented) this.destroy();
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.webContents._destroyed = true;
    windows.delete(this);
    this.emit('closed');
    this.webContents.emit('destroyed');
    if (BrowserWindow.getAllWindows().length === 0) app.emit('window-all-closed');
  }
}

// ─── safeStorage ─────────────────────────────────────────────────────────────
// The shell hands us a 32-byte master key (base64) from the OS keyring via
// MD_MASTER_KEY. launcher.cjs moves it into memory (__setMasterKey) and deletes
// it from process.env before index.ts runs, because agent terminals inherit the
// main process environment. Without one (dev runs), a per-install key file is
// used and the sidecar says so loudly — it is NOT equivalent to Electron's DPAPI
// binding.
let _injectedKey = null;
function setMasterKey(b64) {
  const k = Buffer.from(String(b64), 'base64');
  if (k.length !== 32) throw new Error('[sidecar] MD_MASTER_KEY must be 32 bytes, base64');
  _injectedKey = k;
}
function masterKey() {
  if (_injectedKey) return _injectedKey;
  const file = join(userData, '.sidecar-dev-key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  console.warn('[sidecar] safeStorage: using dev key file (no MD_MASTER_KEY from shell)');
  return Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
}
let _key = null;
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(plain) {
    _key ??= masterKey();
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', _key, iv);
    const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return Buffer.concat([Buffer.from('MDS1'), iv, c.getAuthTag(), body]);
  },
  decryptString(buf) {
    _key ??= masterKey();
    const b = Buffer.from(buf);
    if (b.subarray(0, 4).toString() !== 'MDS1') throw new Error('safeStorage: unrecognised ciphertext');
    const d = crypto.createDecipheriv('aes-256-gcm', _key, b.subarray(4, 16));
    d.setAuthTag(b.subarray(16, 32));
    return Buffer.concat([d.update(b.subarray(32)), d.final()]).toString('utf8');
  }
};

// ─── shell / dialog / clipboard / notifications (host-forwarded) ─────────────
const shell = {
  openExternal: (url) => bridge.hostCall('shell.openExternal', [String(url)]).then(() => undefined),
  openPath: (p) => bridge.hostCall('shell.openPath', [String(p)]).then((r) => r ?? ''),
  showItemInFolder: (p) => { void bridge.hostCall('shell.showItemInFolder', [String(p)]); },
  beep: () => {}
};

const dialog = {
  // (window?, options) like Electron; the UI renders the picker.
  showOpenDialog: (a, b) => bridge.hostCall('dialog.showOpenDialog', [b ?? a])
    .then((r) => r ?? { canceled: true, filePaths: [] }),
  showSaveDialog: (a, b) => bridge.hostCall('dialog.showSaveDialog', [b ?? a])
    .then((r) => r ?? { canceled: true }),
  showMessageBox: (a, b) => bridge.hostCall('dialog.showMessageBox', [b ?? a])
    .then((r) => r ?? { response: (b ?? a).cancelId ?? 0 }),
  // Can't block on a remote UI. Answer the dialog's own cancel choice, which is
  // the non-destructive default in every call site (index.ts floor close).
  showMessageBoxSync: (a, b) => {
    const o = b ?? a;
    console.warn('[sidecar] showMessageBoxSync answered with cancelId:', o.message);
    return o.cancelId ?? o.defaultId ?? 0;
  },
  showErrorBox: (title, content) => { void bridge.hostCall('dialog.showErrorBox', [title, content]); }
};

function clipRead() {
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', windowsHide: true }).replace(/\r?\n$/, '');
    }
    if (process.platform === 'darwin') return execFileSync('pbpaste', { encoding: 'utf8' });
    return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8' });
  } catch { return ''; }
}
function clipWrite(text) {
  try {
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command', '$input | Set-Clipboard'], { input: String(text), windowsHide: true });
    else if (process.platform === 'darwin') execFileSync('pbcopy', { input: String(text) });
    else execFileSync('xclip', ['-selection', 'clipboard'], { input: String(text) });
  } catch { /* best-effort */ }
}
const clipboard = {
  readText: clipRead,
  writeText: clipWrite,
  readImage: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0), toDataURL: () => '' })
};

class Notification extends EventEmitter {
  constructor(opts = {}) { super(); this.opts = opts; }
  static isSupported() { return true; }
  show() {
    bridge.hostCall('notification.show', [{ title: this.opts.title ?? '', body: this.opts.body ?? '' }])
      .then((clicked) => { if (clicked) this.emit('click'); }, () => {});
  }
  close() {}
}

// ─── power / screen / menu ───────────────────────────────────────────────────
const powerMonitor = Object.assign(new EventEmitter(), {
  getSystemIdleTime: () => 0,
  getSystemIdleState: () => 'active',
  isOnBatteryPower: () => false
});
let blockerSeq = 0;
const blockers = new Set();
const powerSaveBlocker = {
  start: () => { const id = ++blockerSeq; blockers.add(id); return id; },
  stop: (id) => { blockers.delete(id); },
  isStarted: (id) => blockers.has(id)
};
const display = { id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const screen = Object.assign(new EventEmitter(), {
  getAllDisplays: () => [display],
  getPrimaryDisplay: () => display,
  getDisplayMatching: () => display,
  getDisplayNearestPoint: () => display,
  getCursorScreenPoint: () => ({ x: 0, y: 0 })
});
const Menu = { buildFromTemplate: (t) => ({ items: t, popup() {} }), setApplicationMenu: () => {}, getApplicationMenu: () => null };

// Stubs for modules index.ts never calls at runtime but some deps touch.
const nativeImage = { createEmpty: () => clipboard.readImage(), createFromPath: () => clipboard.readImage() };
const autoUpdater = Object.assign(new EventEmitter(), { setFeedURL() {}, checkForUpdates() {}, quitAndInstall() {} });

module.exports = {
  app, ipcMain, BrowserWindow, WebContents, safeStorage, shell, dialog, clipboard,
  Notification, powerMonitor, powerSaveBlocker, screen, Menu, nativeImage, autoUpdater,
  // sidecar internals
  __bridge: bridge,
  __windows: windows,
  __setMasterKey: setMasterKey,
  __isSidecarShim: true
};
