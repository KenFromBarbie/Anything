import type { BadgeProps } from "@/shared/ui/badge";

/** How an Office agent's status reads in Buzz. */
const STATUS: Record<
  string,
  { label: string; variant: NonNullable<BadgeProps["variant"]>; live?: boolean }
> = {
  idle: { label: "Idle", variant: "secondary" },
  thinking: { label: "Thinking", variant: "info", live: true },
  working: { label: "Working", variant: "default", live: true },
  waiting: { label: "Waiting on you", variant: "warning" },
  blocked: { label: "Blocked", variant: "destructive" },
  success: { label: "Done", variant: "success" },
  ghost: { label: "Offline", variant: "outline" },
  compacting: { label: "Compacting", variant: "info", live: true },
  looping: { label: "Looping", variant: "warning" },
};

export function agentStatus(status: string) {
  return (
    STATUS[status] ?? {
      label: status.replace(/[-_]/g, " "),
      variant: "secondary" as const,
    }
  );
}

/** "codex · gpt-5.6-sol", or just the provider. */
export function engineLabel(provider: string, model: string | null): string {
  const name = provider.charAt(0).toUpperCase() + provider.slice(1);
  return model ? `${name} · ${model}` : name;
}

/** Share of the context window used, 0–1, when known. */
export function contextShare(
  tokens: number | null,
  limit: number | null,
): number | null {
  if (!tokens || !limit || limit <= 0) return null;
  return Math.min(1, tokens / limit);
}

export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}
