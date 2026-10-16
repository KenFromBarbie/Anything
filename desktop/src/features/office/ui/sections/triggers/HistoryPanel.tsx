import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { officeCth, relTime } from "@/features/office/lib/officeCth";
import { useOfficeAgents } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
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
import { Badge, type BadgeProps } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { Muted } from "../SectionBits";

type Entry = {
  id: string;
  source: "webhook" | "org";
  sourceId: string;
  sourceName: string;
  direction: "inbound" | "outbound";
  peer: string;
  title?: string;
  body: string;
  kind: "directive" | "communication";
  decision?: "auto-allowed" | "pending" | "approved" | "rejected";
  taskId?: string;
  at: number;
};

const KEY = ["office", "trigger-history"] as const;
const DECISION: Record<
  NonNullable<Entry["decision"]>,
  { label: string; variant: BadgeProps["variant"] }
> = {
  pending: { label: "Needs you", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "secondary" },
  "auto-allowed": { label: "Auto-allowed", variant: "outline" },
};

function EntryCard({
  entry,
  michaelName,
}: {
  entry: Entry;
  michaelName: string;
}) {
  const client = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      officeCth<{ ok?: boolean; error?: string } | undefined>(
        "decideTriggerHistory",
        {
          id: entry.id,
          decision,
        },
      ),
    onSuccess: (result) => {
      if (result && result.ok === false)
        toast.error(result.error ?? "That didn't go through. Try again.");
    },
    onError: () => toast.error("That didn't go through. Try again."),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const pending = entry.decision === "pending";
  const long = entry.body.length > 400;
  const decision = entry.decision ? DECISION[entry.decision] : null;

  return (
    <li
      className={cn(
        "grid gap-2 rounded-xl border px-3 py-2",
        pending ? "border-amber-500/40 bg-amber-500/5" : "border-border/70",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          {entry.direction === "inbound" ? "They sent" : "We sent"}
        </span>
        <span className="font-medium">
          {entry.sourceName || "unnamed source"}
        </span>
        <span className="text-muted-foreground">
          {entry.direction === "inbound" ? "from" : "to"}{" "}
          {entry.peer || "unknown"}
        </span>
        <Badge variant="outline">{entry.kind}</Badge>
        {decision ? (
          <Badge variant={decision.variant}>{decision.label}</Badge>
        ) : null}
        {entry.taskId ? (
          <Badge variant="secondary">Task {entry.taskId}</Badge>
        ) : null}
        <span className="flex-1" />
        <span className="tabular-nums text-muted-foreground">
          {relTime(Date.now() - entry.at)}
        </span>
      </div>
      {entry.title ? <p className="font-medium">{entry.title}</p> : null}
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-sm",
          !expanded && long && "line-clamp-4",
        )}
      >
        {entry.body || "(empty message)"}
      </p>
      {long ? (
        <button
          className="justify-self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setExpanded((e) => !e)}
          type="button"
        >
          {expanded ? "Show less" : `Show all ${entry.body.length} characters`}
        </button>
      ) : null}
      {pending ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <p className="flex-1 text-xs text-muted-foreground">
            {entry.kind === "directive"
              ? `Approve and this goes to ${michaelName}, who puts the hive to work on it. Reject and it's dropped.`
              : `Approve and ${michaelName} reads this. Reject and it's dropped.`}
          </p>
          <Button
            disabled={decide.isPending}
            onClick={() => decide.mutate("rejected")}
            size="sm"
            variant="ghost"
          >
            <X />
            Reject
          </Button>
          <Button
            disabled={decide.isPending}
            onClick={() => decide.mutate("approved")}
            size="sm"
          >
            {decide.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Check />
            )}
            Approve
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Everything webhooks and teammates sent in, and what was sent back. */
export function HistoryPanel() {
  const client = useQueryClient();
  const { agents } = useOfficeAgents();
  const michaelName = agents.find((a) => a.isGod)?.name ?? "Michael";
  const history = useQuery({
    queryKey: KEY,
    queryFn: () => officeCth<Entry[] | undefined>("listTriggerHistory"),
    refetchInterval: 5_000,
  });
  const [clearing, setClearing] = React.useState<Entry["source"] | null>(null);
  const clear = useMutation({
    mutationFn: (source: Entry["source"]) =>
      officeCth("clearTriggerHistory", source),
    onError: () => toast.error("Couldn't clear it. Try again."),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const all = [...(history.data ?? [])].sort((a, b) => b.at - a.at);
  const held = all.filter((e) => e.decision === "pending").length;

  return (
    <div className="grid gap-4">
      {held > 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {held === 1 ? "One message is held" : `${held} messages are held`},
          waiting on your yes or no.
        </p>
      ) : null}
      {(["webhook", "org"] as const).map((source) => {
        const entries = all.filter((e) => e.source === source);
        return (
          <div className="grid gap-2" key={source}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {source === "webhook" ? "Webhooks" : "Organisation"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {source === "webhook"
                    ? `Everything posted to your endpoints, next to what ${michaelName} sent back.`
                    : `Messages from teammates' clone nodes, next to what ${michaelName} sent back.`}
                </p>
              </div>
              {entries.length > 0 ? (
                <Button
                  onClick={() => setClearing(source)}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 />
                  Clear
                </Button>
              ) : null}
            </div>
            {entries.length === 0 ? (
              <Muted>{history.isLoading ? "Loading…" : "Nothing yet."}</Muted>
            ) : (
              <ul className="grid gap-2">
                {entries.slice(0, 100).map((entry) => (
                  <EntryCard
                    entry={entry}
                    key={entry.id}
                    michaelName={michaelName}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setClearing(null);
        }}
        open={!!clearing}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clear the {clearing === "org" ? "organisation" : "webhook"}{" "}
              history?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The record of these messages is removed. Tasks they created stay
              on the board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (clearing) clear.mutate(clearing);
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
