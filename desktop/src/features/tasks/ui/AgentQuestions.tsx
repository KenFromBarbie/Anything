import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Reply,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { accentDotClass } from "@/features/office/lib/agentAccent";
import {
  type OfficeAgent,
  useOfficeAgents,
} from "@/features/office/lib/officeLink";
import { agentLabel } from "@/features/tasks/lib/agentNames";
import {
  asksForYou,
  openQuestion,
  stuckBehind,
} from "@/features/tasks/lib/askMe";
import {
  type OfficeTask,
  useAskMeActions,
  useOfficeTasks,
} from "@/features/tasks/lib/useTasksData";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import { SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

import { TaskDialog } from "./TaskDialog";

/** Half-typed answers survive leaving the page (keyed by task and question). */
const drafts = new Map<string, string>();
const draftKey = (taskId: string, q: string) => `${taskId}\u0000${q}`;

function askedAgo(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The agents' questions for you, at the top of the Inbox: decisions and
 * to-dos they can't move a task without. (Questions about work that came
 * from a channel or DM are asked in that thread instead, by the agent.)
 * Answering records it on the task and tells Michael, who unblocks it;
 * dismissing takes it out of the Inbox (the question stays on the task).
 */
export function AgentQuestionsInbox() {
  const { data: tasks = [] } = useOfficeTasks();
  const { agents } = useOfficeAgents();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const asks = asksForYou(tasks);
  const opened = tasks.find((task) => task.id === openId) ?? null;
  if (asks.length === 0) return null;

  return (
    <section
      className="grid gap-2 border-b border-border/60 px-4 pb-4 pt-2"
      data-testid="inbox-agent-questions"
    >
      <button
        className="flex items-center gap-1.5 text-left text-sm font-semibold"
        onClick={() => setCollapsed((value) => !value)}
        type="button"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
        Waiting on you
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {asks.length}
        </span>
      </button>
      {collapsed ? null : (
        <div className="grid gap-3">
          {asks.map((task) => (
            <AskCard
              agents={agents}
              key={task.id}
              onOpenTask={setOpenId}
              task={task}
              tasks={tasks}
            />
          ))}
        </div>
      )}
      <TaskDialog
        agents={agents}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        task={opened}
      />
    </section>
  );
}

/** How many questions are waiting on you (for the Inbox badge). */
export function useOpenQuestionCount(): number {
  const { data: tasks = [] } = useOfficeTasks();
  return asksForYou(tasks).length;
}

function AskCard({
  task,
  tasks,
  agents,
  onOpenTask,
}: {
  task: OfficeTask;
  tasks: OfficeTask[];
  agents: OfficeAgent[];
  onOpenTask: (id: string) => void;
}) {
  const { answer, dismiss } = useAskMeActions();
  const open = openQuestion(task);
  const question = open?.q ?? "";
  const key = draftKey(task.id, question);
  const [text, setText] = React.useState(() => drafts.get(key) ?? "");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [replying, setReplying] = React.useState(() => !!drafts.get(key));
  // No question written down: it's blocked on something (often an approval).
  const shown =
    question ||
    (task.description?.trim()
      ? `**Blocked.** ${task.description.trim()}`
      : "**Blocked**, waiting on you: an approval, a decision or access. Reply to tell the team what to do.");
  const history = (task.humanQA ?? []).filter((entry) => entry !== open);
  const stuck = stuckBehind(task.id, tasks);
  const assignee = task.assignee
    ? agents.find((agent) => agent.id === task.assignee)
    : undefined;
  const busy = answer.isPending || dismiss.isPending;

  const update = (value: string) => {
    setText(value);
    if (value) drafts.set(key, value);
    else drafts.delete(key);
  };
  const respond = () => {
    const value = text.trim();
    if (!value || busy) return;
    answer.mutate(
      { taskId: task.id, q: question, text: value },
      {
        onSuccess: () => {
          update("");
          setReplying(false);
          toast.success("Sent. The work can continue.");
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <article
      className="grid gap-3 rounded-2xl border border-border/70 bg-card/80 p-3 shadow-xs"
      data-testid="agent-question"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            className="text-left font-semibold leading-snug hover:underline"
            onClick={() => onOpenTask(task.id)}
            type="button"
          >
            {task.title}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {task.assignee ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    accentDotClass(assignee?.accent),
                  )}
                />
                {agentLabel(task.assignee, agents)}
              </span>
            ) : null}
            {askedAgo(open?.askedAt) ? (
              <span>Asked {askedAgo(open?.askedAt)}</span>
            ) : null}
          </div>
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            dismiss.mutate(
              { taskId: task.id, q: question },
              {
                onSuccess: () =>
                  toast("Dismissed. The question stays on the task."),
                onError: (error) => toast.error(error.message),
              },
            )
          }
          size="sm"
          title="Take this out of the Inbox without answering. The task stays blocked; the question stays on it."
          variant="ghost"
        >
          <X />
          Dismiss
        </Button>
      </header>

      <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm">
        <Markdown className="leading-6" content={shown} />
      </div>

      {history.length > 0 ? (
        <div className="grid gap-2">
          <button
            className="flex items-center gap-1 text-left"
            onClick={() => setHistoryOpen((value) => !value)}
            type="button"
          >
            {historyOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <SubsectionLabel>
              Earlier on this task · {history.length}
            </SubsectionLabel>
          </button>
          {historyOpen ? (
            <ul className="grid gap-2">
              {history.map((entry, index) => (
                <li
                  className="rounded-xl border border-border/60 px-3 py-2 text-sm"
                  // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
                  key={index}
                >
                  <p className="text-muted-foreground">{entry.q}</p>
                  <p className="mt-1">
                    {entry.a ?? (entry.dismissedAt ? "Dismissed" : "—")}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!replying ? (
        <div className="flex justify-end">
          <Button
            data-testid="agent-question-reply"
            disabled={busy}
            onClick={() => setReplying(true)}
            size="sm"
          >
            <Reply />
            Reply
          </Button>
        </div>
      ) : null}
      <div className={cn("grid gap-2", !replying && "hidden")}>
        <Textarea
          autoFocus
          className="min-h-14 resize-y"
          data-testid="agent-question-answer"
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              respond();
            }
          }}
          placeholder="Your answer, or what you did"
          value={text}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Recorded on the task and sent to Michael. Ctrl+Enter to send.
          </p>
          <Button
            data-testid="agent-question-respond"
            disabled={!text.trim() || busy}
            onClick={respond}
            size="sm"
          >
            {answer.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Send
          </Button>
        </div>
      </div>

      {stuck.length > 0 ? (
        <div className="grid gap-1 border-t border-border/60 pt-3">
          <SubsectionLabel>
            Holding up {stuck.length} {stuck.length === 1 ? "task" : "tasks"}
          </SubsectionLabel>
          <ul className="grid gap-0.5 text-sm text-muted-foreground">
            {stuck.slice(0, 6).map((blocked) => (
              <li key={blocked.id}>
                <button
                  className="truncate text-left hover:text-foreground hover:underline"
                  onClick={() => onOpenTask(blocked.id)}
                  type="button"
                >
                  {blocked.title}
                </button>
              </li>
            ))}
            {stuck.length > 6 ? <li>and {stuck.length - 6} more</li> : null}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
