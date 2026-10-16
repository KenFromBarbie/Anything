import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Which AI account each engine's agents run on, as chosen in Buzz's Settings →
 * AI accounts. Buzz writes the choice to a small JSON file and passes its path
 * as BUZZ_AI_ACCOUNTS_FILE: `{ "claude": "<config dir>" | null, "codex": …,
 * "gemini": … }`. A null (or no file, outside Buzz) means the computer's own
 * sign-in, exactly as before. Agents pick the account up when they (re)start.
 *
 * Each account is a home folder for its CLI:
 *  - Claude Code: a CLAUDE_CONFIG_DIR (credentials, settings, transcripts)
 *  - Codex: a CODEX_HOME whose auth.json signs the agent in
 *  - Gemini CLI: a GEMINI_CLI_HOME
 */
export type AccountEngine = 'claude' | 'codex' | 'gemini';

let cache: { path: string; mtime: number; value: Partial<Record<AccountEngine, string | null>> } | null = null;

function readActive(): Partial<Record<AccountEngine, string | null>> {
  const path = process.env.BUZZ_AI_ACCOUNTS_FILE;
  if (!path || !existsSync(path)) return {};
  try {
    const mtime = statSync(path).mtimeMs;
    if (cache && cache.path === path && cache.mtime === mtime) return cache.value;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const value = parsed && typeof parsed === 'object' ? (parsed as Partial<Record<AccountEngine, string | null>>) : {};
    cache = { path, mtime, value };
    return value;
  } catch {
    return {};
  }
}

/** The account home Buzz picked for an engine, or null for the computer's own. */
export function activeAccountHome(engine: AccountEngine): string | null {
  const home = readActive()[engine];
  return typeof home === 'string' && home && existsSync(home) ? home : null;
}

/** The engine a provider signs in through, if it has switchable accounts. */
export function accountEngineFor(provider: string | undefined): AccountEngine | null {
  if (!provider || provider === 'claude') return 'claude';
  if (provider === 'codex') return 'codex';
  if (provider === 'gemini') return 'gemini';
  return null;
}

/** Point a spawning agent at its engine's chosen account. Codex is handled
 *  where its per-agent CODEX_HOME is assembled (its auth.json comes from the
 *  account's home). */
export function applyAccountEnv(provider: string | undefined, env: Record<string, string>): void {
  const engine = accountEngineFor(provider);
  if (engine === 'claude') {
    const home = activeAccountHome('claude');
    if (home) env.CLAUDE_CONFIG_DIR = home;
  } else if (engine === 'gemini') {
    const home = activeAccountHome('gemini');
    if (home) env.GEMINI_CLI_HOME = home;
  }
}

/** Claude Code's config dir for the active account (its transcripts live in
 *  `<dir>/projects`). */
export function claudeConfigRoot(): string {
  return activeAccountHome('claude') ?? join(homedir(), '.claude');
}

/** Every Claude config dir worth searching for a transcript: the active
 *  account's first, then the computer's own. */
export function claudeConfigRoots(): string[] {
  const roots = [claudeConfigRoot(), join(homedir(), '.claude')];
  return [...new Set(roots)];
}
