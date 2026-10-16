import { accentClasses } from "@/features/office/lib/agentAccent";
import {
  agentStatus,
  compactTokens,
  contextShare,
} from "@/features/office/lib/agentStatus";
import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";

/** An Office agent's avatar: their initial in their accent color. */
export function AgentAvatar({
  agent,
  size = "md",
}: {
  agent: Pick<OfficeAgent, "name" | "accent">;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        accentClasses(agent.accent).solid,
        size === "sm" && "h-6 w-6 text-xs",
        size === "md" && "h-10 w-10 text-base",
        size === "lg" && "h-12 w-12 text-lg",
      )}
    >
      {agent.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function AgentStatusPill({ status }: { status: string }) {
  const { label, variant, live } = agentStatus(status);
  return (
    <Badge
      className={cn("shrink-0", live && "motion-safe:animate-pulse")}
      variant={variant}
    >
      {label}
    </Badge>
  );
}

/** How full the agent's context window is. */
export function ContextMeter({
  agent,
  showLabel = false,
}: {
  agent: Pick<OfficeAgent, "contextTokens" | "contextLimit">;
  showLabel?: boolean;
}) {
  const share = contextShare(agent.contextTokens, agent.contextLimit);
  if (share === null) {
    return showLabel ? (
      <span className="text-xs text-muted-foreground">—</span>
    ) : null;
  }
  const percent = Math.round(share * 100);
  return (
    <div
      className="flex min-w-0 items-center gap-2"
      title={`Context ${compactTokens(agent.contextTokens ?? 0)} of ${compactTokens(agent.contextLimit ?? 0)}`}
    >
      <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            share > 0.85
              ? "bg-destructive"
              : share > 0.6
                ? "bg-amber-500"
                : "bg-primary/70",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {percent}%
        </span>
      ) : null}
    </div>
  );
}
