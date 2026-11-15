import * as React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { accentDotClass } from "@/features/office/lib/agentAccent";
import { type OfficeAgent, useOfficeAgents } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";

/**
 * Who is in this file, like the avatars at the top right of a shared document:
 * the agents working on it right now (and, faded, those who were in the last
 * few minutes), each with what they're doing and where they last changed it.
 * From the Office's presence: the files each agent read, wrote and edited.
 */

const RECENT_MS = 10 * 60_000;

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
const base = (p: string) => norm(p).split("/").pop() ?? "";

type Here = {
  agent: OfficeAgent;
  live: boolean;
  doing: string;
  at: number;
  /** Where its last change to this file was ("lines 40–52"), if it edited it. */
  where?: string;
};

function useAgentsIn(path: string | undefined): Here[] {
  const { agents } = useOfficeAgents();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return React.useMemo(() => {
    if (!path) return [];
    const target = norm(path);
    const name = base(path);
    const out: Here[] = [];
    for (const agent of agents) {
      const p = agent.presence;
      if (!p) continue;
      const onLatest = p.latest && norm(p.latest.path) === target;
      // Steps name the file by its base name: "Read x", "Edited x", "Wrote x".
      const step = [...p.steps]
        .reverse()
        .find((s) => now - s.ts < RECENT_MS && s.text.toLowerCase().endsWith(` ${name}`));
      if (!onLatest && !step) continue;
      const at = step?.ts ?? p.latest?.mtime ?? p.lastAt;
      if (now - at > RECENT_MS) continue;
      const live = p.idleSince === null && now - p.lastAt < 2 * 60_000;
      out.push({ agent, live, doing: step?.text ?? `${p.activity}`, at });
    }
    return out.sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at);
  }, [agents, now, path]);
}

/** The line range of an agent's last change to `path`, from its change log. */
function useLastChange(changesFile: string | undefined, path: string | undefined, stamp: number | undefined): string | undefined {
  const [where, setWhere] = React.useState<string | undefined>();
  React.useEffect(() => {
    if (!changesFile || !path) return;
    let alive = true;
    fetch(`${convertFileSrc(changesFile)}?v=${stamp ?? 0}`)
      .then((r) => r.text())
      .then((text) => {
        const target = norm(path);
        const lines = text.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line?.trim()) continue;
          try {
            const c = JSON.parse(line) as { path?: string; hunks?: { line?: number; new?: string }[] };
            if (!c.path || norm(c.path) !== target) continue;
            const h = c.hunks?.find((x) => typeof x.line === "number");
            if (h && typeof h.line === "number") {
              const n = Math.max(1, (h.new ?? "").split("\n").length);
              if (alive) setWhere(n > 1 ? `lines ${h.line}–${h.line + n - 1}` : `line ${h.line}`);
            }
            return;
          } catch {
            /* a half-written line */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [changesFile, path, stamp]);
  return where;
}

function Avatar({ here, path }: { here: Here; path: string }) {
  const changes = here.agent.presence?.changes;
  const where = useLastChange(changes?.file, path, changes?.lastAt);
  const initial = here.agent.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="group relative">
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white shadow-sm",
          accentDotClass(here.agent.accent),
          !here.live && "opacity-45",
        )}
      >
        {initial}
      </span>
      {here.live ? (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" />
      ) : null}
      <div className="pointer-events-none absolute right-0 top-9 z-50 hidden w-60 rounded-lg border border-border bg-popover p-2.5 text-left text-xs text-popover-foreground shadow-lg group-hover:block">
        <div className="font-semibold">{here.agent.name}</div>
        <div className="mt-0.5 text-muted-foreground">
          {here.live ? "In this file now" : "Was here a few minutes ago"}
        </div>
        <div className="mt-1.5">{here.doing}</div>
        {where ? <div className="mt-0.5 text-muted-foreground">Last change: {where}</div> : null}
      </div>
    </div>
  );
}

/** The avatar stack, plus a live line naming who is editing right now. */
export function FilePresence({ path, className }: { path?: string; className?: string }) {
  const here = useAgentsIn(path);
  if (!path || here.length === 0) return null;
  const editing = here.filter((h) => h.live && /^(Edited|Wrote) /.test(h.doing));
  return (
    <div className={cn("flex items-center gap-2", className)} data-testid="file-presence">
      {editing.length ? (
        <span className="hidden items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs shadow-sm sm:flex">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {editing.map((h) => h.agent.name).join(", ")} {editing.length > 1 ? "are" : "is"} editing
        </span>
      ) : null}
      <div className="flex -space-x-2">
        {here.slice(0, 6).map((h) => (
          <Avatar here={h} key={h.agent.id} path={path} />
        ))}
        {here.length > 6 ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold">
            +{here.length - 6}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The open editor's file, for its title bar's presence (set by EditorHost). */
export const EditorPathContext = React.createContext<string | undefined>(undefined);

/** FilePresence for the editor that's open. */
export function EditorPresence() {
  const path = React.useContext(EditorPathContext);
  return <FilePresence className="shrink-0" path={path} />;
}
