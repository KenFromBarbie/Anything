import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';

/**
 * Write JSON so a crash leaves the old file or the new one, never a torn or
 * hollow one. Temp + rename alone isn't enough: after a power cut the rename
 * can land before the bytes do (that left a store as NUL bytes), so the
 * bytes are flushed to disk first.
 */
export function writeJsonDurably(p: string, value: unknown): void {
  const tmp = `${p}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, JSON.stringify(value, null, 2), null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, p);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* the tmp file is disposable */ }
    throw e;
  }
}
