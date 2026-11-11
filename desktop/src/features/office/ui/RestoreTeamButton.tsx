import * as React from "react";
import { Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

/**
 * Last session's agents, brought back by choice. Each agent is a CLI process
 * of ~200 MB, so a large team isn't restored on its own when the app opens
 * (it filled the computer's memory): the owner restores one at a time, or all,
 * and the Office starts them two at a time.
 */
export function RestoreTeamButton() {
  const { restorable, restoring, restoreProgress } = useOfficeAgents();
  const [open, setOpen] = React.useState(false);

  if (restorable.length === 0 && !restoring) return null;

  const run = (op: string, args: Record<string, unknown>) => {
    callOffice(op, args)
      .then((result) => {
        // The Office says why an agent didn't start (e.g. low memory).
        const r = (result ?? {}) as { ok?: boolean; note?: string | null };
        if (r.ok === false && r.note) {
          toast.error(
            /free memory/.test(r.note)
              ? "Couldn't restore: the computer is low on memory (an agent needs about 1.2 GB free to start). Close some apps or agents and try again."
              : `Couldn't restore everyone: ${r.note}`,
          );
        }
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <Popover onOpenChange={setOpen} open={open && !restoring}>
      <PopoverTrigger asChild>
        <Button
          className="pointer-events-auto shadow-md"
          data-testid="office-restore-team"
          disabled={restoring}
          size="sm"
          variant="outline"
        >
          <RotateCcw />
          {restoring
            ? restoreProgress && restoreProgress.total > 0
              ? `Restoring ${restoreProgress.done}/${restoreProgress.total}…`
              : "Restoring…"
            : `Restore team (${restorable.length})`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-1 pb-2 text-xs text-muted-foreground">
          Last session&apos;s agents. Each one uses about 200 MB while it runs.
        </p>
        <ul className="grid max-h-80 gap-0.5 overflow-y-auto overflow-x-hidden">
          {restorable.map((agent) => (
            <li
              className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent"
              data-testid="office-restorable-agent"
              key={agent.id}
            >
              <span className="grid min-w-0 flex-1" title={agent.description}>
                <span className="truncate text-sm">{agent.name}</span>
                {agent.description ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {agent.description}
                  </span>
                ) : null}
              </span>
              <Button
                aria-label={`Restore ${agent.name}`}
                className="h-7 w-7"
                onClick={() => run("agents.restore", { ids: [agent.id] })}
                size="icon"
                title={`Restore ${agent.name}`}
                variant="ghost"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
              <Button
                aria-label={`Remove ${agent.name} from this list`}
                className="h-7 w-7 text-muted-foreground"
                onClick={() =>
                  run("agents.dismissRestorable", { id: agent.id })
                }
                size="icon"
                title={`Remove ${agent.name} from this list for good`}
                variant="ghost"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          className="mt-2 w-full"
          onClick={() => {
            setOpen(false);
            run("agents.restore", {});
          }}
          size="sm"
        >
          <Play />
          Restore all ({restorable.length})
        </Button>
      </PopoverContent>
    </Popover>
  );
}
