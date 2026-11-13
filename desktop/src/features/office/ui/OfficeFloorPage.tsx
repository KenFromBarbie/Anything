import * as React from "react";
import { createPortal } from "react-dom";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  ListChecks,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Users,
  X,
} from "lucide-react";
import { openMeetingDialog } from "@/features/office/lib/meetingRoom";
import { toast } from "sonner";

import {
  accentClasses,
  accentDotClass,
} from "@/features/office/lib/agentAccent";
import { OFFICE_GLASS } from "@/features/office/lib/glass";
import {
  setOfficeAnchor,
  setOfficeFullWindow,
} from "@/features/office/lib/officeAnchor";
import {
  type FloorPoint,
  onFloorAgent,
  setFloorSource,
  setFloorTasksHandler,
  trackAgent,
} from "@/features/office/lib/officeFloorEvents";
import {
  type OfficeAgent,
  useOfficeAgents,
} from "@/features/office/lib/officeLink";
import { useShowOfficePart } from "@/features/office/lib/officeView";
import { agentLabel } from "@/features/tasks/lib/agentNames";
import {
  type OfficeTask,
  useOfficeTaskActions,
  useOfficeTasks,
} from "@/features/tasks/lib/useTasksData";
import { TaskDialog } from "@/features/tasks/ui/TaskDialog";
import { BOARD_COLUMNS, openQuestion } from "@/features/tasks/ui/taskStyles";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useSidebar } from "@/shared/ui/sidebar";

import { AgentChat } from "./agents/AgentChat";
import { RestoreTeamButton } from "./RestoreTeamButton";

const GAP = 12;
const CHAT_WIDTH = 340;
const TASKS_WIDTH = 360;
const TASK_WIDTH = 320;

/**
 * The Office page: the background floor comes forward and fills the window
 * (the sidebar folds away while it's open). Click a character to chat with
 * them in a small window above their head; the Tasks button (or the floor's
 * task board) opens the tasks in a small window, and each task opens its own.
 *
 * The floor is the live Office frame, laid over the whole window in line with
 * the background floor (see OfficeHost); the windows here sit above it.
 */
export function OfficeFloorPage() {
  useShowOfficePart("office");
  useFoldedSidebar();
  // The one Office frame is laid over the page (with the background on, it is
  // the same frame that sits behind the app elsewhere, so nothing reloads).
  useOfficeFocus();
  const { agents } = useOfficeAgents();
  const [chat, setChat] = React.useState<{
    id: string;
    at: FloorPoint | null;
  } | null>(null);
  const [tasksOpen, setTasksOpen] = React.useState(false);
  const [taskId, setTaskId] = React.useState<string | null>(null);

  // A character clicked on the floor opens their chat above their head; the
  // floor then reports where they stand every frame they move, and the chat
  // follows (see ChatBubble).
  React.useEffect(
    () =>
      onFloorAgent((event) => {
        if (event.kind === "click") setChat({ id: event.id, at: event.at });
      }),
    [],
  );
  const chatId = chat?.id ?? null;
  React.useEffect(() => trackAgent(chatId), [chatId]);

  // The floor's task board opens the tasks window here, not the Tasks page.
  React.useEffect(() => {
    setFloorTasksHandler(() => setTasksOpen(true));
    return () => setFloorTasksHandler(null);
  }, []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (taskId) setTaskId(null);
      else if (chatId) setChat(null);
      else setTasksOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatId, taskId]);

  const chatAgent = agents.find((a) => a.id === chatId) ?? null;

  return (
    <div
      className="relative flex min-h-0 flex-1"
      data-testid="office-page-content"
    >
      <div
        className="absolute inset-0"
        data-testid="office-embed"
        ref={setOfficeAnchor}
      />
      {createPortal(
        <>
          <div className="pointer-events-none fixed right-4 top-14 z-40 flex gap-2">
            <RestoreTeamButton />
            <Button
              className="pointer-events-auto shadow-md"
              data-testid="office-open-meeting"
              onClick={openMeetingDialog}
              size="sm"
              variant="outline"
            >
              <Users />
              Meeting room
            </Button>
            <Button
              className="pointer-events-auto shadow-md"
              data-testid="office-open-tasks"
              onClick={() => {
                setTasksOpen((open) => !open);
                setTaskId(null);
              }}
              size="sm"
              variant={tasksOpen ? "default" : "outline"}
            >
              <ListChecks />
              Tasks
            </Button>
          </div>
          {chatAgent ? (
            <ChatBubble
              agent={chatAgent}
              at={chat?.at ?? null}
              onClose={() => setChat(null)}
            />
          ) : null}
          {tasksOpen ? (
            <TasksWindow
              agents={agents}
              onClose={() => {
                setTasksOpen(false);
                setTaskId(null);
              }}
              onOpenTask={setTaskId}
              openTaskId={taskId}
            />
          ) : null}
          {tasksOpen && taskId ? (
            <TaskWindow
              agents={agents}
              onClose={() => setTaskId(null)}
              taskId={taskId}
            />
          ) : null}
        </>,
        document.body,
      )}
    </div>
  );
}

/** Fold the sidebar away while the page is open; put it back on leaving. */
function useFoldedSidebar() {
  const { open, setOpen } = useSidebar();
  const openRef = React.useRef(open);
  openRef.current = open;
  const setOpenRef = React.useRef(setOpen);
  setOpenRef.current = setOpen;
  React.useEffect(() => {
    const wasOpen = openRef.current;
    setOpenRef.current(false);
    return () => setOpenRef.current(wasOpen);
  }, []);
}

/** The wash lifted off the background floor, and the floor this page uses;
 *  both go back on leaving. */
function useOfficeFocus() {
  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-office-focus", "");
    root.removeAttribute("data-office-entering");
    setFloorSource("main");
    setOfficeFullWindow(true);
    return () => {
      root.removeAttribute("data-office-focus");
      setFloorSource("main");
      setOfficeFullWindow(false);
    };
  }, []);
}

/** A small window with a header, floating over the floor. */
function FloatingWindow({
  children,
  className,
  onClose,
  style,
  subtitle,
  testId,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  onClose: () => void;
  style?: React.CSSProperties;
  subtitle?: string;
  testId: string;
  title: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden rounded-2xl animate-in fade-in zoom-in-95 duration-150",
        OFFICE_GLASS,
        className,
      )}
      data-testid={testId}
      style={style}
    >
      <header className="flex items-center justify-between gap-2 py-2.5 pl-4 pr-2">
        <div className="grid min-w-0">
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <Button
          aria-label="Close"
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

/** An agent's chat, above their head (or above the strip until the floor
 *  says where they are). */
function ChatBubble({
  agent,
  at,
  onClose,
}: {
  agent: OfficeAgent;
  at: FloorPoint | null;
  onClose: () => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const caretRef = React.useRef<HTMLSpanElement>(null);
  // Above the head or below it, kept while the agent moves about (it only
  // flips near the top of the window, with some room either way).
  const aboveRef = React.useRef<boolean | null>(null);

  // Placed straight on the element, every frame the agent moves, so it keeps
  // up with them without re-rendering the chat.
  const place = React.useCallback((point: FloorPoint | null) => {
    const wrap = wrapRef.current;
    const caret = caretRef.current;
    if (!wrap) return;
    const width = Math.min(CHAT_WIDTH, window.innerWidth - 2 * GAP);
    const center = point?.x ?? window.innerWidth / 2;
    const left = Math.min(
      Math.max(GAP, center - width / 2),
      window.innerWidth - width - GAP,
    );
    let above = aboveRef.current;
    if (!point) above = true;
    else if (above === null) above = point.y > 320;
    else if (above && point.y < 290) above = false;
    else if (!above && point.y > 360) above = true;
    aboveRef.current = above;
    wrap.style.width = `${width}px`;
    wrap.style.left = `${left}px`;
    if (!point) {
      wrap.style.top = "";
      wrap.style.bottom = "72px";
    } else if (above) {
      wrap.style.top = "";
      wrap.style.bottom = `${window.innerHeight - point.y + GAP}px`;
    } else {
      wrap.style.bottom = "";
      wrap.style.top = `${point.y + 72}px`;
    }
    if (caret) {
      caret.style.display = point ? "" : "none";
      caret.style.left = `${Math.min(Math.max(16, center - left), width - 16) - 6}px`;
      caret.dataset.side = above ? "above" : "below";
    }
  }, []);

  React.useLayoutEffect(() => place(at), [at, place]);
  React.useEffect(
    () =>
      onFloorAgent((event) => {
        if (event.kind === "anchor" && event.id === agent.id && event.at) {
          place(event.at);
        }
      }),
    [agent.id, place],
  );

  return (
    <div
      className="pointer-events-none fixed z-40"
      data-testid="office-chat-bubble"
      ref={wrapRef}
    >
      <div className="pointer-events-auto relative">
        <FloatingWindow
          className="static max-h-[min(440px,70vh)] w-full"
          onClose={onClose}
          testId="office-chat"
          title={
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  accentDotClass(agent.accent),
                )}
              />
              {agent.name}
              <span className="truncate text-xs font-normal text-muted-foreground">
                {agent.action || agent.status}
              </span>
            </span>
          }
        >
          <AgentChat agent={agent} compact key={agent.id} />
        </FloatingWindow>
        <span
          aria-hidden
          className="absolute h-3 w-3 rotate-45 border-white/40 bg-background/80 backdrop-blur-2xl dark:border-white/10 data-[side=above]:-bottom-1.5 data-[side=above]:border-b data-[side=above]:border-r data-[side=below]:-top-1.5 data-[side=below]:border-l data-[side=below]:border-t"
          ref={caretRef}
        />
      </div>
    </div>
  );
}

/** The board, small: one status at a time, newest work first. */
function TasksWindow({
  agents,
  onClose,
  onOpenTask,
  openTaskId,
}: {
  agents: OfficeAgent[];
  onClose: () => void;
  onOpenTask: (id: string | null) => void;
  openTaskId: string | null;
}) {
  const { data: tasks = [], isLoading } = useOfficeTasks();
  const { add } = useOfficeTaskActions();
  const [picked, setStatus] = React.useState<OfficeTask["status"] | null>(null);
  // Until one is picked: what's being worked on, else what's next.
  const status =
    picked ??
    (["doing", "todo", "blocked", "done"] as const).find((s) =>
      tasks.some((task) => task.status === s),
    ) ??
    "todo";
  const [title, setTitle] = React.useState("");
  const shown = tasks
    .filter((task) => task.status === status)
    .sort((a, b) =>
      status === "done"
        ? b.createdAt.localeCompare(a.createdAt)
        : a.priority - b.priority,
    );
  const agentById = React.useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const asks = tasks.filter(
    (task) => task.status !== "done" && openQuestion(task),
  ).length;

  const addTask = (event: React.FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    add.mutate(
      { title: value },
      {
        onSuccess: () => {
          setTitle("");
          setStatus("todo");
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <FloatingWindow
      className="right-4 top-24 max-h-[min(600px,calc(100vh-11rem))]"
      onClose={onClose}
      style={{ width: Math.min(TASKS_WIDTH, window.innerWidth - 2 * GAP) }}
      subtitle={
        asks
          ? `${asks} ${asks === 1 ? "task asks" : "tasks ask"} you something`
          : `${tasks.filter((t) => t.status !== "done").length} open`
      }
      testId="office-tasks"
      title={
        <span className="flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Tasks
        </span>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-4 gap-1.5" role="tablist">
          {BOARD_COLUMNS.map((column) => {
            const count = tasks.filter(
              (t) => t.status === column.status,
            ).length;
            const on = status === column.status;
            return (
              <button
                aria-selected={on}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                  on
                    ? "bg-foreground/10 ring-1 ring-foreground/20"
                    : "bg-foreground/[0.03] hover:bg-foreground/[0.07]",
                )}
                key={column.status}
                onClick={() => setStatus(column.status)}
                role="tab"
                type="button"
              >
                <span className="text-lg font-semibold leading-none tabular-nums">
                  {count}
                </span>
                <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", column.dot)}
                  />
                  {column.label}
                </span>
              </button>
            );
          })}
        </div>

        <form className="relative" onSubmit={addTask}>
          <Plus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="New task"
            className="h-9 rounded-xl border-foreground/10 bg-foreground/[0.04] pl-9 pr-16"
            disabled={add.isPending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task"
            value={title}
          />
          {title.trim() ? (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-foreground/15 px-1.5 py-0.5 text-2xs text-muted-foreground">
              Enter
            </kbd>
          ) : null}
        </form>

        <ul className="-mx-1 grid gap-0.5">
          {shown.map((task) => {
            const assignee = task.assignee
              ? agentById.get(task.assignee)
              : undefined;
            const question = openQuestion(task);
            const open = openTaskId === task.id;
            return (
              <li key={task.id}>
                <button
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                    open ? "bg-foreground/10" : "hover:bg-foreground/[0.06]",
                  )}
                  data-testid="office-task-row"
                  onClick={() => onOpenTask(open ? null : task.id)}
                  type="button"
                >
                  <StatusMark status={task.status} />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span
                      className={cn(
                        "line-clamp-2 text-sm leading-snug",
                        task.status === "done"
                          ? "text-muted-foreground"
                          : "font-medium",
                      )}
                    >
                      {task.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {task.assignee ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded-full text-3xs font-semibold",
                              accentClasses(assignee?.accent).solid,
                            )}
                          >
                            {agentLabel(task.assignee, agents)
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                          {agentLabel(task.assignee, agents)}
                        </span>
                      ) : (
                        <span>Unassigned</span>
                      )}
                      {question ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-2xs text-amber-600 dark:text-amber-400">
                          <MessageCircleQuestion className="h-3 w-3" />
                          Asks you
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 ? (
            <li className="flex flex-col items-center gap-1 px-2 py-8 text-center text-xs text-muted-foreground">
              {isLoading ? (
                "Loading…"
              ) : (
                <>
                  <ListChecks className="h-5 w-5 opacity-50" />
                  {status === "blocked"
                    ? "Nothing is stuck."
                    : status === "doing"
                      ? "No one is working on anything right now."
                      : status === "done"
                        ? "Nothing finished yet."
                        : "Nothing waiting. Add a task above."}
                </>
              )}
            </li>
          ) : null}
        </ul>
      </div>
    </FloatingWindow>
  );
}

/** Where a task is, at a glance: open, being worked on, stuck or done. */
function StatusMark({ status }: { status: OfficeTask["status"] }) {
  if (status === "doing") {
    return (
      <span className="relative mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <span className="absolute h-3.5 w-3.5 rounded-full bg-blue-500/30 motion-safe:animate-ping" />
        <span className="h-2 w-2 rounded-full bg-blue-500" />
      </span>
    );
  }
  if (status === "done") {
    return <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />;
  }
  if (status === "blocked") {
    return <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />;
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

/** One task, small, beside the tasks window. */
function TaskWindow({
  agents,
  onClose,
  taskId,
}: {
  agents: OfficeAgent[];
  onClose: () => void;
  taskId: string;
}) {
  const { data: tasks = [] } = useOfficeTasks();
  const { patch } = useOfficeTaskActions();
  const [editing, setEditing] = React.useState(false);
  const task = tasks.find((t) => t.id === taskId) ?? null;
  const tasksWidth = Math.min(TASKS_WIDTH, window.innerWidth - 2 * GAP);
  const width = Math.min(TASK_WIDTH, window.innerWidth - 2 * GAP);
  // Beside the tasks window when it fits, otherwise over it.
  const right =
    window.innerWidth - tasksWidth - width - 3 * GAP > 0
      ? 16 + tasksWidth + GAP
      : 16;
  if (!task) return null;
  const question = openQuestion(task);
  return (
    <>
      <FloatingWindow
        className="top-24 max-h-[min(560px,calc(100vh-11rem))]"
        onClose={onClose}
        style={{ right, width }}
        testId="office-task"
        title={task.title}
      >
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap gap-1">
            {BOARD_COLUMNS.map((column) => (
              <button
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                  task.status === column.status
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 hover:bg-muted",
                )}
                key={column.status}
                onClick={() => {
                  if (task.status === column.status) return;
                  patch.mutate(
                    { id: task.id, patch: { status: column.status } },
                    { onError: (error) => toast.error(error.message) },
                  );
                }}
                type="button"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", column.dot)} />
                {column.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {task.assignee
              ? `Assigned to ${agentLabel(task.assignee, agents)}`
              : "Unassigned"}
          </p>
          {task.description ? (
            <p className="whitespace-pre-wrap break-words">
              {task.description}
            </p>
          ) : (
            <p className="text-muted-foreground">No description.</p>
          )}
          {question ? (
            <button
              className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-left text-xs"
              onClick={() => {
                window.location.hash = "#/";
              }}
              type="button"
            >
              <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium">Asks you: </span>
                {question}
              </span>
            </button>
          ) : null}
          <div className="flex justify-between gap-2">
            <Button
              onClick={() => setEditing(true)}
              size="sm"
              variant="outline"
            >
              <Pencil />
              Edit
            </Button>
            <Button
              onClick={() => {
                window.location.hash = "#/tasks";
              }}
              size="sm"
              variant="ghost"
            >
              <ExternalLink />
              Board
            </Button>
          </div>
        </div>
      </FloatingWindow>
      <TaskDialog
        agents={agents}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
        task={editing ? task : null}
      />
    </>
  );
}
