import * as React from "react";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";

/**
 * An agent paused by the operator refuses every action ("Paused by operator")
 * and quietly waits, which stalled a whole course once without anyone
 * noticing: the pause showed only inside the Office's own controls. This says
 * so plainly, anywhere in the app, with a one-click Resume.
 */
export function PausedAgentsBanner() {
  const { agents } = useOfficeAgents();
  const [paused, setPaused] = React.useState<{ id: string; name: string }[]>([]);
  const ids = agents.map((a) => a.id).join(",");
  React.useEffect(() => {
    let alive = true;
    const check = async () => {
      const found: { id: string; name: string }[] = [];
      for (const a of agents) {
        try {
          const snap = await callOffice<{ paused?: boolean } | null>("agent.control", { id: a.id });
          if (snap?.paused) found.push({ id: a.id, name: a.name });
        } catch {
          /* office busy; next round */
        }
      }
      if (alive) setPaused(found);
    };
    void check();
    const t = setInterval(check, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  if (!paused.length) return null;
  const names = paused.map((p) => p.name).join(", ");
  return (
    <div
      className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-500/40 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg dark:bg-amber-950 dark:text-amber-100"
      data-testid="paused-agents-banner"
      role="status"
    >
      <span>
        <strong>{names}</strong> {paused.length === 1 ? "is paused: nothing it tries can run." : "are paused: nothing they try can run."}
      </span>
      <button
        className="rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
        onClick={() => {
          for (const p of paused) void callOffice("agent.pause", { id: p.id, on: false }).catch(() => undefined);
          setPaused([]);
        }}
        type="button"
      >
        Resume
      </button>
    </div>
  );
}
