// The Code app's session logic: what's sent to the coding agent, which part
// of its transcript belongs to this codebase's conversation, whether it's
// working, and what it changed (file by file, with diffs).

import type { FileEditDiff } from "@/features/agents/ui/agentSessionFileEditDiff";
import { buildCompactToolSummary } from "@/features/agents/ui/agentSessionToolSummary";
import type { TranscriptItem } from "@/features/agents/ui/agentSessionTypes";

export type ToolItem = Extract<TranscriptItem, { type: "tool" }>;

export type CodeTarget = { name: string; path: string; branch?: string | null };

/** The header every request carries, so the agent works in the right folder
 *  even though it starts in its own home. */
export function codePrompt(target: CodeTarget, text: string, first: boolean): string {
  const head = `[Code · ${target.name}] Work in the codebase at ${target.path}${target.branch ? ` (branch ${target.branch})` : ""}. Use absolute paths inside it.`;
  const rules = first
    ? "\nYou're the owner's coding agent in the app's Code view: read before you edit, make focused changes, run the project's checks (tests, typecheck, lint) after changing code, and say briefly what you changed and how you checked it. Don't commit or push unless asked."
    : "";
  return `${head}${rules}\n\n${text.trim()}`;
}

/** Strip the header back off for display. */
export function displayPrompt(text: string): string {
  const m = /^\[Code · [^\]]+\][^\n]*(\n[^\n]*You're the owner's coding agent[^\n]*)?\n\n/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** The transcript items of one conversation (its DM channel). Items without a
 *  channel follow the last channel seen (tool calls inside a turn). */
export function scopeToChannel(items: readonly TranscriptItem[], channelId: string | null): TranscriptItem[] {
  if (!channelId) return [];
  const out: TranscriptItem[] = [];
  let current: string | null = null;
  for (const it of items) {
    const ch = (it as { channelId?: string | null }).channelId ?? null;
    if (ch) current = ch;
    if ((ch ?? current) === channelId) out.push(it);
  }
  return out;
}

/** Working: a tool is still running, or the newest thing is the owner's
 *  request with no answer yet. */
export function isWorking(items: readonly TranscriptItem[]): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === "tool") return it.status === "executing" || it.status === "pending";
    if (it.type === "message") return it.role === "user";
    if (it.type === "thought") return true;
  }
  return false;
}

export type FileChange = {
  path: string;
  filename: string;
  additions: number;
  deletions: number;
  edits: { id: string; at: string; diff: FileEditDiff }[];
};

/** Every file the agent changed in this conversation, newest change first. */
export function collectChanges(items: readonly TranscriptItem[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const it of items) {
    if (it.type !== "tool" || it.isError || it.status === "failed") continue;
    const diff = buildCompactToolSummary(it).fileEditDiff;
    if (!diff?.path) continue;
    const c = byPath.get(diff.path) ?? { path: diff.path, filename: diff.filename, additions: 0, deletions: 0, edits: [] };
    c.additions += diff.additions;
    c.deletions += diff.deletions;
    c.edits.push({ id: it.id, at: it.completedAt ?? it.timestamp, diff });
    byPath.delete(diff.path);
    byPath.set(diff.path, c);
  }
  return [...byPath.values()].reverse();
}

/** A path shown relative to the codebase when it's inside it. */
export function relPath(path: string, root: string | null | undefined): string {
  const p = path.replace(/\\/g, "/");
  const r = (root ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (r && p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return p.slice(r.length + 1);
  return p;
}

/** The coding agents: local harness agents, Claude Code first. */
export function codingAgentRank(agent: { agentCommand: string; name: string }): number {
  const c = `${agent.agentCommand} ${agent.name}`.toLowerCase();
  if (/claude/.test(c)) return 0;
  if (/codex|code|goose|opencode/.test(c)) return 1;
  return 2;
}
