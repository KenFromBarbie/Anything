'use strict';
/**
 * Wire format shared by the sidecar server (Node) and the web client.
 *
 * Electron IPC uses structured clone; we use JSON plus two tagged types that
 * the hive actually sends across IPC: binary buffers and Dates.
 *
 * client -> server
 *   { t: 'hello', role?: 'primary' | 'floor' }
 *   { t: 'invoke', id, ch, args }        ipcRenderer.invoke
 *   { t: 'send', ch, args }              ipcRenderer.send
 *   { t: 'sync', id, ch, args }          ipcRenderer.sendSync (answered async)
 *   { t: 'callResult', id, ok, value?, error? }   answer to a server 'call'
 *
 * server -> client
 *   { t: 'welcome', windowId, version }
 *   { t: 'result', id, ok, value?, error? }
 *   { t: 'event', ch, args }             webContents.send
 *   { t: 'call', id, op, args }          host capability the UI must perform
 */

function encode(msg) {
  return JSON.stringify(msg, function (key, value) {
    const raw = this[key];
    if (raw instanceof Uint8Array) return { __u8: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('base64') };
    if (raw instanceof Date) return { __date: raw.toISOString() };
    if (raw === undefined && Array.isArray(this)) return { __undef: 1 };
    return value;
  });
}

function decode(text) {
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === 'object') {
      if (typeof value.__u8 === 'string') return Buffer.from(value.__u8, 'base64');
      if (typeof value.__date === 'string') return new Date(value.__date);
      if (value.__undef === 1) return undefined;
    }
    return value;
  });
}

module.exports = { encode, decode };
