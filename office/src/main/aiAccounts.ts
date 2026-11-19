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
export type AccountEngine = 'claude' | 'codex' | 'gemini' | 'kimi' | 'opencode';

/** Who an agent is, for its account: the CEO and executives ("managers")
 *  or the floor workers they hire ("workers"), which can run on another. */
export type AccountRole = 'managers' | 'workers';

type ActiveFile = Partial<Record<string, string | null>>;
let cache: { path: string; mtime: number; value: ActiveFile } | null = null;

function readActive(): ActiveFile {
  const path = process.env.BUZZ_AI_ACCOUNTS_FILE;
  if (!path || !existsSync(path)) return {};
  try {
    const mtime = statSync(path).mtimeMs;
    if (cache && cache.path === path && cache.mtime === mtime) return cache.value;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const value = parsed && typeof parsed === 'object' ? (parsed as ActiveFile) : {};
    cache = { path, mtime, value };
    return value;
  } catch {
    return {};
  }
}

/** The account home Buzz picked for an engine, or null for the computer's own. */
export function activeAccountHome(engine: AccountEngine, role: AccountRole = 'managers'): string | null {
  const file = readActive();
  if (role === 'workers' && `${engine}:workers` in file) {
    const w = file[`${engine}:workers`];
    if (w === 'default') return null; // this computer's own sign-in
    if (typeof w === 'string' && w && existsSync(w)) return w;
  }
  const home = file[engine];
  return typeof home === 'string' && home && existsSync(home) ? home : null;
}

/** The engine a provider signs in through, if it has switchable accounts. */
export function accountEngineFor(provider: string | undefined): AccountEngine | null {
  if (!provider || provider === 'claude') return 'claude';
  if (provider === 'codex') return 'codex';
  // Google's CLI is Antigravity now (it keeps Gemini's home and sign-in).
  if (provider === 'gemini' || provider === 'antigravity') return 'gemini';
  if (provider === 'kimi') return 'kimi';
  if (provider === 'opencode') return 'opencode';
  return null;
}

/** Point a spawning agent at its engine's chosen account. Codex is handled
 *  where its per-agent CODEX_HOME is assembled (its auth.json comes from the
 *  account's home). */
export function applyAccountEnv(provider: string | undefined, env: Record<string, string>, role: AccountRole = 'managers'): void {
  const engine = accountEngineFor(provider);
  if (engine === 'claude') {
    const home = claudeHomeFor(role);
    if (home) env.CLAUDE_CONFIG_DIR = home;
  } else if (engine === 'kimi') {
    const home = activeAccountHome('kimi', role);
    if (home) env.KIMI_CODE_HOME = home;
  } else if (engine === 'opencode') {
    // opencode keeps its sign-ins in $XDG_DATA_HOME/opencode/auth.json.
    const home = activeAccountHome('opencode', role);
    if (home) env.XDG_DATA_HOME = home;
  } else if (engine === 'gemini') {
    const home = activeAccountHome('gemini', role);
    if (home) env.GEMINI_CLI_HOME = home;
  }
}

/** The Claude config dir an agent of this role runs on (null = the
 *  computer's own ~/.claude). A floor-workers account that isn't signed in (no
 *  saved sign-in in its folder) would make every new worker's Claude open a
 *  browser sign-in on its own, so workers use the managers' account until it
 *  is signed in. */
export function claudeHomeFor(role: AccountRole): string | null {
  const home = activeAccountHome('claude', role);
  if (home && role === 'workers' && !existsSync(join(home, '.credentials.json'))) {
    return activeAccountHome('claude', 'managers');
  }
  return home;
}

/** Claude Code's config dir for the active account (its transcripts live in
 *  `<dir>/projects`). */
export function claudeConfigRoot(): string {
  return activeAccountHome('claude') ?? join(homedir(), '.claude');
}

/** Every Claude config dir worth searching for a transcript: the active
 *  account's first, then the computer's own. */
export function claudeConfigRoots(): string[] {
  const workers = activeAccountHome('claude', 'workers');
  const roots = [claudeConfigRoot(), ...(workers ? [workers] : []), join(homedir(), '.claude')];
  return [...new Set(roots)];
}
