import { invoke } from "@tauri-apps/api/core";

/**
 * The AI subscriptions the Office's agents run on (Rust: `ai_accounts`). Each
 * engine — Claude Code, Codex (ChatGPT), Gemini CLI (Google) — has "This
 * computer" (its normal sign-in) plus any accounts added here; the active one
 * is what agents start on.
 */

export type Engine = "claude" | "codex" | "gemini";

export type AiAccount = {
  id: string;
  label: string;
  isDefault: boolean;
  /** Runs on an API key rather than a subscription sign-in. */
  apiKey: boolean;
  home: string;
  signedIn: boolean;
  email: string | null;
  name: string | null;
  organization: string | null;
  plan: string | null;
};

export type EngineAccounts = {
  engine: Engine;
  label: string;
  cli: string;
  cliInstalled: boolean;
  active: string;
  accounts: AiAccount[];
};

export type UsageWindow = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
};

export type UsageLimit = {
  label: string;
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
};

export type AccountUsage = {
  last5h: UsageWindow;
  today: UsageWindow;
  week: UsageWindow;
  limits: UsageLimit[];
  plan: string | null;
  limitsAt: number | null;
  note: string | null;
};

export const listAiAccounts = () =>
  invoke<EngineAccounts[]>("ai_accounts_list");
export const addAiAccount = (engine: Engine, label: string) =>
  invoke<string>("ai_accounts_add", { engine, label });
/** Add an account that runs on an API key the owner pasted. */
export const addApiKeyAccount = (engine: Engine, label: string, key: string) =>
  invoke<string>("ai_accounts_add_api_key", { engine, label, key });
export const setAiAccountApiKey = (engine: Engine, id: string, key: string) =>
  invoke<void>("ai_accounts_set_api_key", { engine, id, key });
export const API_KEY_HINT: Record<Engine, string> = {
  claude: "An Anthropic API key (sk-ant-…), from console.anthropic.com",
  codex: "An OpenAI API key (sk-…), from platform.openai.com",
  gemini: "A Gemini API key, from aistudio.google.com",
};
export const signInAiAccount = (engine: Engine, id: string) =>
  invoke<void>("ai_accounts_sign_in", { engine, id });
export const setActiveAiAccount = (engine: Engine, id: string) =>
  invoke<void>("ai_accounts_set_active", { engine, id });
export const renameAiAccount = (engine: Engine, id: string, label: string) =>
  invoke<void>("ai_accounts_rename", { engine, id, label });
export const removeAiAccount = (engine: Engine, id: string) =>
  invoke<void>("ai_accounts_remove", { engine, id });
export const aiAccountUsage = (engine: Engine, id: string) =>
  invoke<AccountUsage>("ai_accounts_usage", { engine, id });

/** Tokens a window counted (input incl. cache, plus output). */
export function windowTotal(w: UsageWindow): number {
  return w.input + w.output + w.cacheRead + w.cacheWrite;
}

export const ENGINE_CLI_NAME: Record<Engine, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

/** What happens when an account reaches one of its caps. */
export type AtCap = "switch" | "freeze" | "warn";

/** Usage caps for one account (Rust: `ai_accounts::guard`). Token caps count
 *  the same total the usage panel shows (input, output and cache). */
export type UsageRule = {
  cap5h: number | null;
  capDay: number | null;
  capWeek: number | null;
  /** Percent of the plan's own limit, where the CLI reports one. */
  capPercent: number | null;
  atCap: AtCap;
};

export type UsageFreeze = { manual: boolean; reason: string; since: number };

export type UsageGuard = {
  /** By "engine:account id". */
  rules: Record<string, UsageRule>;
  /** By engine. */
  frozen: Record<string, UsageFreeze>;
  /** Newest first. */
  log: { at: number; engine: Engine; text: string }[];
};

export const ruleKey = (engine: Engine, id: string) => `${engine}:${id}`;

export const getUsageGuard = () => invoke<UsageGuard>("ai_accounts_guard");
export const setUsageRule = (
  engine: Engine,
  id: string,
  rule: UsageRule | null,
) => invoke<void>("ai_accounts_set_rule", { engine, id, rule });
export const freezeEngine = (engine: Engine, on: boolean) =>
  invoke<void>("ai_accounts_freeze", { engine, on });
