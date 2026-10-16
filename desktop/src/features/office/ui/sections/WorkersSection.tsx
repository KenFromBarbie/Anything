import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Square } from "lucide-react";
import { toast } from "sonner";

import { fmtTokens, officeCth } from "@/features/office/lib/officeCth";
import { useOfficeAgents } from "@/features/office/lib/officeLink";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { Muted, SectionCard } from "./SectionBits";

type WorkersData = {
  live: {
    workerId: string;
    name: string;
    status: string;
    releasing?: boolean;
    hasSlack?: boolean;
    baseBranch: string;
    ageMs: number;
    idleMs: number | null;
    tokensUsed: number;
    tokenCap: number | null;
  }[];
  preserved: {
    workerId: string;
    wtPath: string;
    baseBranch: string;
    preservedAt: number;
  }[];
  maxWorkers: number;
};

function age(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

const KEY = ["office", "workers"] as const;

/** The short-lived workers Michael spins up (e.g. for Slack threads). */
export function WorkersSection() {
  const client = useQueryClient();
  const { agents } = useOfficeAgents();
  const michael = agents.find((agent) => agent.isGod)?.name ?? "Michael";
  const workers = useQuery({
    queryKey: KEY,
    queryFn: () => officeCth<WorkersData>("listWorkers"),
    refetchInterval: 2_000,
  });
  const stop = useMutation({
    mutationFn: (workerId: string) =>
      officeCth<{ ok: boolean; error?: string }>("stopWorker", workerId),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error ?? "Couldn't stop the worker.");
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const live = workers.data?.live ?? [];
  const preserved = workers.data?.preserved ?? [];

  return (
    <div className="grid gap-4" data-testid="section-workers">
      <SectionCard
        action={
          <span className="text-sm tabular-nums text-muted-foreground">
            {live.length} / {workers.data?.maxWorkers ?? 4}
          </span>
        }
        description={`Isolated workers ${michael} spins up for incoming requests. Each runs to completion, replies, then tears down.`}
        title="Live workers"
      >
        {live.length === 0 ? (
          <Muted>
            {workers.isLoading ? "Loading…" : "No workers running right now."}
          </Muted>
        ) : (
          <ul className="grid gap-2">
            {live.map((worker) => {
              const stopping =
                worker.releasing ||
                (stop.isPending && stop.variables === worker.workerId);
              return (
                <li
                  className="grid gap-2 rounded-xl border border-border/70 px-3 py-2"
                  key={worker.workerId}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={worker.releasing ? "secondary" : "success"}>
                      {worker.releasing ? "Stopping" : "Working"}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {worker.name}
                    </span>
                    {worker.hasSlack ? (
                      <Badge variant="outline">Slack</Badge>
                    ) : null}
                    <Button
                      disabled={stopping}
                      onClick={() => stop.mutate(worker.workerId)}
                      size="sm"
                      title="Stop this worker. Its work is kept."
                      variant="outline"
                    >
                      {stopping ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Square />
                      )}
                      Stop
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                    <span>{worker.workerId}</span>
                    <span>base: {worker.baseBranch}</span>
                    <span>up {age(worker.ageMs)}</span>
                    <span>
                      {worker.idleMs === null
                        ? "terminal gone"
                        : `idle ${age(worker.idleMs)}`}
                    </span>
                    <span>
                      tokens {fmtTokens(worker.tokensUsed)}
                      {worker.tokenCap !== null
                        ? ` / ${fmtTokens(worker.tokenCap)}`
                        : " · uncapped"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {preserved.length > 0 ? (
        <SectionCard
          description="Finished workers whose worktree held work not yet merged. Kept, and reclaimed once the work lands in its base branch."
          title={`Preserved worktrees · ${preserved.length}`}
        >
          <ul className="grid gap-2">
            {preserved.map((tree) => (
              <li
                className="grid gap-1 rounded-xl border border-border/70 px-3 py-2"
                key={tree.wtPath}
              >
                <span className="font-medium">{tree.workerId}</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                  <span className="break-all">{tree.wtPath}</span>
                  <span>base: {tree.baseBranch}</span>
                  <span>
                    kept {age(Math.max(0, Date.now() - tree.preservedAt))} ago
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
