import * as React from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  ListChecks,
  MessageCircleQuestion,
  MessageSquare,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { accentDotClass } from "@/features/office/lib/agentAccent";
import {
  setOfficeAnchor,
  setOfficeFullWindow,
} from "@/features/office/lib/officeAnchor";
import {
  type FloorPoint,
  onFloorAgent,
  requestAgentAnchor,
  setFloorTasksHandler,
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
  useOfficeFocus();
  const { agents } = useOfficeAgents();
  const [chat, setChat] = React.useState<{
    id: string;
    at: FloorPoint | null;
  } | null>(null);
  const [tasksOpen, setTasksOpen] = React.useState(false);
  const [taskId, setTaskId] = React.useState<string | null>(null);

  // A character clicked on the floor opens their chat above their head; the
  // floor's answers about where they stand keep it there as they move.
  React.useEffect(
    () =>
      onFloorAgent((event) => {
        if (event.kind === "click") {
          setChat({ id: event.id, at: event.at });
          return;
        }
        setChat((current) =>
          current && current.id === event.id && event.at
            ? { id: current.id, at: event.at }
            : current,
        );
      }),
    [],
  );
  const chatId = chat?.id ?? null;
  React.useEffect(() => {
    if (!chatId) return;
    requestAgentAnchor(chatId);
    const timer = setInterval(() => requestAgentAnchor(chatId), 700);
    return () => clearInterval(timer);
  }, [chatId]);

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
          <AgentStrip
            activeId={chatId}
            agents={agents}
            onPick={(id) => {
              if (chatId === id) {
                setChat(null);
                return;
              }
              setChat({ id, at: null });
              requestAgentAnchor(id);
            }}
          />
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

/** The floor across the whole window, with the wash lifted off the
 *  background floor; both go back on leaving. */
function useOfficeFocus() {
  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-office-focus", "");
    root.removeAttribute("data-office-entering");
    setOfficeFullWindow(true);
    return () => {
      root.removeAttribute("data-office-focus");
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
  testId,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  onClose: () => void;
  style?: React.CSSProperties;
  testId: string;
  title: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-2xl backdrop-blur animate-in fade-in zoom-in-95 duration-150",
        className,
      )}
      data-testid={testId}
      style={style}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        <Button
          aria-label="Close"
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
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
  const width = Math.min(CHAT_WIDTH, window.innerWidth - 2 * GAP);
  const center = at?.x ?? window.innerWidth / 2;
  const left = Math.min(
    Math.max(GAP, center - width / 2),
    window.innerWidth - width - GAP,
  );
  // Above the head when there's room; otherwise just below it.
  const above = !at || at.y > 320;
  const style: React.CSSProperties = at
    ? above
      ? { left, width, bottom: window.innerHeight - at.y + GAP }
      : { left, width, top: at.y + 72 }
    : { left, width, bottom: 72 };
  const caret = Math.min(Math.max(16, center - left), width - 16);
  return (
    <div
      className="pointer-events-none fixed z-40"
      data-testid="office-chat-bubble"
      style={style}
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
        {at ? (
          <span
            aria-hidden
            className={cn(
              "absolute h-3 w-3 rotate-45 border-border/70 bg-background/95",
              above
                ? "-bottom-1.5 border-b border-r"
                : "-top-1.5 border-l border-t",
            )}
            style={{ left: caret - 6 }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The floor's agents, for opening a chat without finding them first. */
function AgentStrip({
  activeId,
  agents,
  onPick,
}: {
  activeId: string | null;
  agents: OfficeAgent[];
  onPick: (id: string) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <nav
      aria-label="Chat with an agent"
      className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-border/70 bg-background/90 p-1 shadow-lg backdrop-blur"
      data-testid="office-agent-strip"
    >
      <MessageSquare className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
      {agents.map((agent) => (
        <button
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
            activeId === agent.id
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted",
          )}
          key={agent.id}
          onClick={() => onPick(agent.id)}
          type="button"
        >
          <span
            className={cn("h-2 w-2 rounded-full", accentDotClass(agent.accent))}
          />
          {agent.name}
        </button>
      ))}
    </nav>
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
    .sort((a, b) => a.priority - b.priority);
  const agentById = React.useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

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
      className="right-4 top-24 max-h-[min(560px,calc(100vh-11rem))]"
      onClose={onClose}
      style={{ width: Math.min(TASKS_WIDTH, window.innerWidth - 2 * GAP) }}
      testId="office-tasks"
      title={
        <span className="flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Tasks
        </span>
      }
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-1" role="tablist">
          {BOARD_COLUMNS.map((column) => {
            const count = tasks.filter(
              (t) => t.status === column.status,
            ).length;
            return (
              <button
                aria-selected={status === column.status}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                  status === column.status
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 hover:bg-muted",
                )}
                key={column.status}
                onClick={() => setStatus(column.status)}
                role="tab"
                type="button"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", column.dot)} />
                {column.label}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <form className="flex gap-1.5" onSubmit={addTask}>
          <Input
            className="h-8"
            disabled={add.isPending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New task, then Enter"
            value={title}
          />
          <Button
            aria-label="Add the task"
            disabled={!title.trim() || add.isPending}
            size="icon"
            type="submit"
            variant="outline"
          >
            <Plus />
          </Button>
        </form>
        <ul className="grid gap-1">
          {shown.map((task) => {
            const assignee = task.assignee
              ? agentById.get(task.assignee)
              : undefined;
            return (
              <li key={task.id}>
                <button
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:bg-muted/60",
                    openTaskId === task.id && "border-border bg-muted/60",
                  )}
                  data-testid="office-task-row"
                  onClick={() =>
                    onOpenTask(openTaskId === task.id ? null : task.id)
                  }
                  type="button"
                >
                  <span className="line-clamp-2 text-sm font-medium leading-snug">
                    {task.title}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {task.assignee ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            accentDotClass(assignee?.accent),
                          )}
                        />
                        {agentLabel(task.assignee, agents)}
                      </span>
                    ) : (
                      "Unassigned"
                    )}
                    {openQuestion(task) ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <MessageCircleQuestion className="h-3 w-3" />
                        Asks you
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 ? (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              {isLoading ? "Loading…" : "Nothing here"}
            </li>
          ) : null}
        </ul>
      </div>
    </FloatingWindow>
  );
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
                window.location.hash = "#/ask-me";
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
