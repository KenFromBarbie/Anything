import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { useOfficeTaskActions } from "@/features/tasks/lib/useTasksData";
import { Button } from "@/shared/ui/button";
import { SectionHeader } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

import { SELECT_CLASS } from "./taskStyles";

/**
 * Work for the floor: it goes to Michael, who breaks it into tasks and assigns
 * them. Picking an agent passes them on as a suggestion.
 */
export function DispatchCard({ agents }: { agents: OfficeAgent[] }) {
  const { dispatch } = useOfficeTaskActions();
  const [text, setText] = React.useState("");
  const [suggestedId, setSuggestedId] = React.useState("");
  const workers = agents.filter((agent) => !agent.isGod);
  const michael = agents.find((agent) => agent.isGod);

  const send = (event?: React.FormEvent) => {
    event?.preventDefault();
    const body = text.trim();
    if (!body || dispatch.isPending) return;
    dispatch.mutate(
      { text: body, suggestedId: suggestedId || undefined },
      {
        onSuccess: () => {
          setText("");
          setSuggestedId("");
          toast.success(`Sent to ${michael?.name ?? "Michael"}.`);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <form
      className="grid gap-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-xs"
      data-testid="tasks-dispatch"
      onSubmit={send}
    >
      <SectionHeader
        description={`${michael?.name ?? "Michael"} breaks it into tasks and hands them out.`}
        title="Dispatch"
      />
      <Textarea
        className="min-h-20 resize-y"
        data-testid="tasks-dispatch-text"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            send();
          }
        }}
        placeholder="Describe the work for the floor…"
        value={text}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Suggest
          <select
            className={SELECT_CLASS}
            data-testid="tasks-dispatch-suggest"
            disabled={workers.length === 0}
            onChange={(event) => setSuggestedId(event.target.value)}
            value={suggestedId}
          >
            <option value="">Anyone</option>
            {workers.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          data-testid="tasks-dispatch-send"
          disabled={!text.trim() || dispatch.isPending}
          size="sm"
          type="submit"
        >
          {dispatch.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          Send to {michael?.name ?? "Michael"}
        </Button>
      </div>
    </form>
  );
}
