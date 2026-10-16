import * as React from "react";
import { Loader2, Navigation, Send, X } from "lucide-react";
import { toast } from "sonner";

import type { OfficeAgent } from "@/features/office/lib/officeLink";
import {
  useFloorDelivery,
  useOfficeAgentActions,
} from "@/features/office/lib/useOfficeAgentControls";
import { Button } from "@/shared/ui/button";
import { SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

function ago(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/**
 * Messages for the agent: queued, they're typed into the terminal as soon as
 * the agent is free (or held while auto delivery is off). A worker can also be
 * steered: the note reaches them mid-run, without waiting for the queue.
 */
export function QueueComposer({ agent }: { agent: OfficeAgent }) {
  const actions = useOfficeAgentActions(agent.id);
  const delivery = useFloorDelivery(true);
  const [text, setText] = React.useState("");
  const held = !!delivery.data?.paused;
  const busy = actions.message.isPending || actions.steer.isPending;

  const queue = () => {
    const body = text.trim();
    if (!body || busy) return;
    actions.message.mutate(
      { text: body },
      {
        onSuccess: () => setText(""),
        onError: (error) => toast.error(error.message),
      },
    );
  };
  const steer = () => {
    const body = text.trim();
    if (!body || busy) return;
    actions.steer.mutate(
      { text: body },
      {
        onSuccess: () => {
          setText("");
          toast(`${agent.name} gets that at their next step.`);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div
      className="grid gap-3 rounded-2xl border border-border/70 bg-card/80 p-3 shadow-xs"
      data-testid="agents-queue"
    >
      {agent.queue.length > 0 ? (
        <div className="grid gap-1.5">
          <SubsectionLabel>Queued · {agent.queue.length}</SubsectionLabel>
          {agent.queue.map((message) => (
            <div
              className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"
              key={message.id}
            >
              <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap">
                {message.text}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {ago(message.ts)}
              </span>
              <Button
                aria-label="Remove from the queue"
                onClick={() =>
                  actions.removeQueued.mutate(message.id, {
                    onError: (error) => toast.error(error.message),
                  })
                }
                size="icon-xs"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <Textarea
        className="min-h-16 resize-y"
        data-testid="agents-queue-text"
        disabled={!agent.hasTerminal}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            queue();
          }
        }}
        placeholder={
          agent.hasTerminal
            ? `Message ${agent.name}`
            : `${agent.name} has no terminal running`
        }
        value={text}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {held
            ? "Auto delivery is off: messages wait here."
            : `Typed into ${agent.name}'s terminal when they're free. Shift+Enter for a new line.`}
        </p>
        <div className="flex gap-2">
          {agent.isGod ? null : (
            <Button
              disabled={!text.trim() || busy || !agent.hasTerminal}
              onClick={steer}
              size="sm"
              title={`Reach ${agent.name} mid-run, without waiting for the queue.`}
              variant="outline"
            >
              <Navigation />
              Steer now
            </Button>
          )}
          <Button
            data-testid="agents-queue-send"
            disabled={!text.trim() || busy || !agent.hasTerminal}
            onClick={queue}
            size="sm"
          >
            {actions.message.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Send />
            )}
            Queue
          </Button>
        </div>
      </div>
    </div>
  );
}
