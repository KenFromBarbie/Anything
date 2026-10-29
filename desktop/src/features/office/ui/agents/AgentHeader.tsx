import * as React from "react";
import {
  Ban,
  Code2,
  Hand,
  type LucideIcon,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  ShieldOff,
  SquareTerminal,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { engineLabel } from "@/features/office/lib/agentStatus";
import type { OfficeAgent } from "@/features/office/lib/officeLink";
import {
  useAgentControl,
  useFloorDelivery,
  useOfficeAgentActions,
} from "@/features/office/lib/useOfficeAgentControls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Switch } from "@/shared/ui/switch";

import { AgentAvatar, AgentStatusPill } from "./AgentBits";
import { AgentFormDialog } from "./AgentFormDialog";

const onError = (error: Error) => toast.error(error.message);

/**
 * The selected agent: who they are and what they're doing, and their controls.
 * Michael's are the floor's (auto delivery for every queue, the IDE); a
 * worker's restrain the worker (block tools, stop after this step), take them
 * aside for a 1:1, or edit and archive them.
 */
export function AgentHeader({
  agent,
  michaelName,
  onChat,
  chatPending = false,
  panels = [],
  onOpenPanel,
}: {
  agent: OfficeAgent;
  michaelName: string;
  /** Chat: their DM in the Inbox. */
  onChat?: () => void;
  chatPending?: boolean;
  /** The Office's panels for this agent (git, messages, traces), opened from
   *  the menu: the page has one row of tabs, the page's own. */
  panels?: { key: string; label: string; icon: LucideIcon }[];
  onOpenPanel?: (key: string) => void;
}) {
  const actions = useOfficeAgentActions(agent.id);
  const control = useAgentControl(agent.id, !agent.isGod && agent.hasTerminal);
  const delivery = useFloorDelivery(agent.isGod);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const paused = !!control.data?.paused;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      data-testid="agents-header"
    >
      <div className="flex min-w-0 items-center gap-3">
        <AgentAvatar agent={agent} size="lg" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {agent.name}
            </h2>
            <AgentStatusPill status={agent.status} />
            {control.data?.halted ? (
              <span className="text-xs text-destructive">
                Stopping after this step
              </span>
            ) : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {agent.isGod
              ? `${agent.name} runs the floor`
              : agent.project || agent.cwd}
            {" · "}
            {engineLabel(agent.provider, agent.model)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {agent.isGod ? (
          <label
            className="flex h-8 items-center gap-2 rounded-lg border border-input/40 px-3 text-sm"
            htmlFor="agents-auto-delivery"
            title="Queued messages go to each agent as soon as it's free. Turn off to hold every queue on the floor."
          >
            <Switch
              checked={!delivery.data?.paused}
              data-testid="agents-auto-delivery"
              id="agents-auto-delivery"
              disabled={!delivery.data || actions.floorDelivery.isPending}
              onCheckedChange={(on) =>
                actions.floorDelivery.mutate(!on, { onError })
              }
            />
            Auto delivery
          </label>
        ) : agent.hasTerminal ? (
          <>
            <Button
              data-testid="agents-block-tools"
              onClick={() => actions.pause.mutate(!paused, { onError })}
              size="sm"
              title={
                paused
                  ? `Let ${agent.name} use tools again.`
                  : `Deny ${agent.name}'s tool calls from the next step on; they keep their context.`
              }
              variant={paused ? "default" : "outline"}
            >
              {paused ? <ShieldCheck /> : <ShieldOff />}
              {paused ? "Allow tools" : "Block tools"}
            </Button>
            <Button
              onClick={() =>
                actions.halt.mutate(
                  {},
                  {
                    onError,
                    onSuccess: () =>
                      toast(`${agent.name} stops after this step.`),
                  },
                )
              }
              size="sm"
              title={`${agent.name} finishes the current step, then stops cleanly.`}
              variant="outline"
            >
              <Hand />
              Stop after this step
            </Button>
            <Button
              data-testid="agents-hold"
              onClick={() => actions.hold.mutate(!agent.onHold, { onError })}
              size="sm"
              title={
                agent.onHold
                  ? `End the 1:1. ${michaelName} can hand ${agent.name} work again.`
                  : `Take ${agent.name} aside: ${michaelName} stops sending them work until you end it. They keep running and answering you.`
              }
              variant={agent.onHold ? "default" : "outline"}
            >
              <Users />
              {agent.onHold ? "End 1:1" : "1:1"}
            </Button>
          </>
        ) : null}
        {onChat ? (
          <Button
            data-testid="agent-chat"
            disabled={chatPending}
            onClick={onChat}
            size="sm"
            title={`Your DM with ${agent.name}, in the Inbox.`}
            variant="outline"
          >
            <MessageSquare />
            Chat
          </Button>
        ) : null}
        <Button
          data-testid="agents-ide"
          onClick={() => actions.ide.mutate({}, { onError })}
          size="sm"
          title={`Open the editor on ${agent.name}'s workspace.`}
          variant="outline"
        >
          <Code2 />
          IDE
        </Button>
        {agent.isGod ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`More for ${agent.name}`}
                size="icon"
                variant="outline"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil />
                Edit agent
              </DropdownMenuItem>
              {panels.map(({ key, label, icon: Icon }) => (
                <DropdownMenuItem
                  data-testid={`agent-panel-${key}`}
                  key={key}
                  onSelect={() => onOpenPanel?.(key)}
                >
                  <Icon />
                  <span className="capitalize">{label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onSelect={() => actions.openTerminal.mutate({}, { onError })}
              >
                <SquareTerminal />
                Open a system terminal here
              </DropdownMenuItem>
              {agent.hasTerminal ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setConfirmArchive(true)}
                  >
                    <Ban />
                    Close terminal and archive
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <AgentFormDialog
        agentId={agent.id}
        mode="edit"
        onOpenChange={setEditing}
        open={editing}
      />
      <AlertDialog onOpenChange={setConfirmArchive} open={confirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {agent.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their terminal closes and they leave the floor. The Office keeps
              them in its archive, where they can be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => actions.archive.mutate({}, { onError })}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
