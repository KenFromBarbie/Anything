/**
 * What each agent changed, file by file, for the app's change viewer (Create →
 * Live now → Watch → Changes). Built from the hook stream:
 *
 *  - Edit / MultiEdit: the exact text replaced (old → new), plus the line it
 *    starts on (read from the file after the edit);
 *  - Write: the whole file before (read at PreToolUse) and after;
 *  - files a script wrote (found by the presence scan): just that it changed.
 *
 * One JSON line per change in `<hive>/changes/<agentId>.jsonl` (the app reads
 * it from there), capped per agent, plus a running summary for the cards.
 */
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

export interface ChangeHunk { old: string; new: string; line?: number }
export interface Change {
  id: string;
  ts: number;
  tool: string;
  path: string;
  /** created | edited | written (whole file) | updated (by a script) */
  op: 'created' | 'edited' | 'written' | 'updated';
  hunks: ChangeHunk[];
  added: number;
  removed: number;
  /** Whole-file content was too big or binary to keep. */
  truncated?: boolean;
}
export interface ChangeSummary { file: string; count: number; added: number; removed: number; files: number; lastAt: number }

const MAX_TEXT = 400_000;
const MAX_PER_AGENT = 400;

const lines = (s: string) => (s ? s.split('\n').length : 0);
const isText = (s: string) => !s.includes('\u0000');

/** Lines added / removed between two texts (a quick LCS-free count: lines
 *  only in one side, by multiset). Good enough for a +N −M badge. */
export function lineDelta(a: string, b: string): { added: number; removed: number } {
  const count = new Map<string, number>();
  for (const l of a ? a.split('\n') : []) count.set(l, (count.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of b ? b.split('\n') : []) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return { added, removed };
}

export class ChangeTracker {
  private before = new Map<string, string | null>();
  private summary = new Map<string, ChangeSummary>();
  private seen = new Map<string, number>();
  private queue = new Map<string, Promise<void>>();

  constructor(private hiveRoot: () => string | null) {}

  private fileFor(agentId: string): string | null {
    const root = this.hiveRoot();
    return root ? join(root, 'changes', `${agentId.replace(/[^A-Za-z0-9_.-]/g, '_')}.jsonl`) : null;
  }

  summaryOf(agentId: string): ChangeSummary | null {
    return this.summary.get(agentId) ?? null;
  }

  /** Feed every hook event; returns true when a change was recorded. */
  async handle(agentId: string, event: string, tool: string, input: unknown): Promise<boolean> {
    const i = (input ?? {}) as Record<string, unknown>;
    const path = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : '';
    if (!path || !/^(write|edit|multiedit)$/i.test(tool)) return false;
    const key = `${agentId}\u0000${path}`;
    if (event === 'PreToolUse') {
      if (/^write$/i.test(tool)) this.before.set(key, await readText(path));
      return false;
    }
    if (event !== 'PostToolUse') return false;
    let change: Change;
    const base = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), tool, path };
    if (/^write$/i.test(tool)) {
      const prev = this.before.has(key) ? this.before.get(key) ?? null : null;
      this.before.delete(key);
      const next = typeof i.content === 'string' ? i.content : ((await readText(path)) ?? '');
      const big = (prev?.length ?? 0) > MAX_TEXT || next.length > MAX_TEXT || !isText(next);
      const d = lineDelta(prev ?? '', next);
      change = {
        ...base,
        op: prev == null ? 'created' : 'written',
        hunks: big ? [] : [{ old: prev ?? '', new: next, line: 1 }],
        added: d.added,
        removed: d.removed,
        ...(big ? { truncated: true } : {})
      };
    } else {
      const edits: { old_string?: unknown; new_string?: unknown }[] = /^multiedit$/i.test(tool) && Array.isArray(i.edits)
        ? (i.edits as { old_string?: unknown; new_string?: unknown }[])
        : [i as { old_string?: unknown; new_string?: unknown }];
      const after = await readText(path);
      const hunks: ChangeHunk[] = edits
        .map((e) => ({ old: String(e.old_string ?? ''), new: String(e.new_string ?? '') }))
        .filter((h) => h.old !== h.new)
        .map((h) => {
          const at = after && h.new ? after.indexOf(h.new) : -1;
          return at >= 0 ? { ...h, line: lines(after!.slice(0, at)) || 1 } : h;
        });
      if (!hunks.length) return false;
      let added = 0;
      let removed = 0;
      for (const h of hunks) {
        const d = lineDelta(h.old, h.new);
        added += d.added;
        removed += d.removed;
      }
      change = { ...base, op: 'edited', hunks, added, removed };
    }
    await this.append(agentId, change);
    return true;
  }

  /** A file a script wrote (no diff, just that it changed). */
  async updated(agentId: string, path: string, mtime: number): Promise<boolean> {
    const key = `${agentId}\u0000${path}`;
    if ((this.seen.get(key) ?? 0) >= mtime) return false;
    this.seen.set(key, mtime);
    await this.append(agentId, {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      tool: 'script',
      path,
      op: 'updated',
      hunks: [],
      added: 0,
      removed: 0
    });
    return true;
  }

  private append(agentId: string, change: Change): Promise<void> {
    const prev = this.queue.get(agentId) ?? Promise.resolve();
    const next = prev.then(() => this.write(agentId, change)).catch(() => undefined);
    this.queue.set(agentId, next);
    return next;
  }

  private async write(agentId: string, change: Change): Promise<void> {
    const file = this.fileFor(agentId);
    if (!file) return;
    await fsp.mkdir(join(file, '..'), { recursive: true });
    let existing: string[] = [];
    try {
      existing = (await fsp.readFile(file, 'utf8')).split('\n').filter(Boolean);
    } catch { /* first change */ }
    existing.push(JSON.stringify(change));
    if (existing.length > MAX_PER_AGENT) existing = existing.slice(-MAX_PER_AGENT);
    await fsp.writeFile(`${file}.tmp`, existing.join('\n') + '\n');
    await fsp.rename(`${file}.tmp`, file);
    const s = this.summary.get(agentId) ?? { file, count: 0, added: 0, removed: 0, files: 0, lastAt: 0 };
    const files = new Set(existing.map((l) => { try { return (JSON.parse(l) as Change).path; } catch { return ''; } }));
    this.summary.set(agentId, {
      file,
      count: s.count + 1,
      added: s.added + change.added,
      removed: s.removed + change.removed,
      files: files.size,
      lastAt: change.ts
    });
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    const st = await fsp.stat(path);
    if (!st.isFile() || st.size > MAX_TEXT) return null;
    const t = await fsp.readFile(path, 'utf8');
    return isText(t) ? t : null;
  } catch {
    return null;
  }
}
