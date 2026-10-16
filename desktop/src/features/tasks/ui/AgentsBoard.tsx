import * as React from "react";
import { Loader2, MessageCircleQuestion, Plus } from "lucide-react";
import { toast } from "sonner";

import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { accentDotClass } from "@/features/office/lib/agentAccent";
import { agentLabel } from "@/features/tasks/lib/agentNames";
import {
  type OfficeTask,
  useOfficeTaskActions,
} from "@/features/tasks/lib/useTasksData";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { TaskDialog } from "./TaskDialog";
import { BOARD_COLUMNS, openQuestion } from "./taskStyles";

const DRAG_TYPE = "application/x-buzz-office-task";

/**
 * The Office's board in Buzz: what Michael and the agents are working on, by
 * status. Cards open the task; dragging one to another column moves it.
 */
export function AgentsBoard({
  agents,
  tasks,
  loading,
  onOpenAskMe,
}: {
  agents: OfficeAgent[];
  tasks: OfficeTask[];
  loading: boolean;
  onOpenAskMe: () => void;
}) {
  const { add, patch } = useOfficeTaskActions();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const opened = tasks.find((task) => task.id === openId) ?? null;
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
        onSuccess: () => setTitle(""),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const move = (id: string, status: OfficeTask["status"]) => {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    patch.mutate(
      { id, patch: { status } },
      { onError: (error) => toast.error(error.message) },
    );
  };

  return (
    <>
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
        data-testid="tasks-board"
      >
        {BOARD_COLUMNS.map((column) => {
          const items = tasks
            .filter((task) => task.status === column.status)
            .sort((a, b) => a.priority - b.priority);
          return (
            <section
              aria-label={column.label}
              className={cn(
                "flex min-h-40 flex-col gap-2 rounded-2xl border border-border/70 bg-muted/20 p-2 transition-colors",
                dropTarget === column.status && "border-ring bg-muted/50",
              )}
              data-testid={`tasks-column-${column.status}`}
              key={column.status}
              onDragLeave={() => setDropTarget(null)}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                event.preventDefault();
                setDropTarget(column.status);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(null);
                const id = event.dataTransfer.getData(DRAG_TYPE);
                if (id) move(id, column.status);
              }}
            >
              <header className="flex items-center justify-between px-2 pt-1">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", column.dot)} />
                  <h3 className="text-sm font-semibold">{column.label}</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                {column.status === "todo" ? (
                  <Button
                    aria-label="Add a task"
                    data-testid="tasks-add"
                    onClick={() => setAdding((value) => !value)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Plus />
                  </Button>
                ) : null}
              </header>
              {column.status === "todo" && adding ? (
                <form className="px-1" onSubmit={addTask}>
                  <Input
                    autoFocus
                    data-testid="tasks-add-title"
                    disabled={add.isPending}
                    onBlur={() => {
                      if (!title.trim()) setAdding(false);
                    }}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setTitle("");
                        setAdding(false);
                      }
                    }}
                    placeholder="Task title, then Enter"
                    value={title}
                  />
                </form>
              ) : null}
              <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-1 pb-1">
                {items.map((task) => (
                  <TaskCard
                    assignee={
                      task.assignee ? agentById.get(task.assignee) : undefined
                    }
                    assigneeId={task.assignee}
                    assigneeName={
                      task.assignee
                        ? agentLabel(task.assignee, agents)
                        : undefined
                    }
                    key={task.id}
                    onOpen={() => setOpenId(task.id)}
                    onOpenAskMe={onOpenAskMe}
                    task={task}
                  />
                ))}
                {items.length === 0 && !(adding && column.status === "todo") ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    {loading && column.status === "todo" ? (
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    ) : (
                      "Nothing here"
                    )}
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      <TaskDialog
        agents={agents}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        task={opened}
      />
    </>
  );
}

function TaskCard({
  task,
  assignee,
  assigneeId,
  assigneeName,
  onOpen,
  onOpenAskMe,
}: {
  task: OfficeTask;
  assignee: OfficeAgent | undefined;
  assigneeId: string | undefined;
  assigneeName: string | undefined;
  onOpen: () => void;
  onOpenAskMe: () => void;
}) {
  const question = openQuestion(task);
  // The whole card opens the task (a button stretched over it); the "Asks
  // you" badge sits above that button.
  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border/70 bg-card p-3 text-left shadow-xs transition-colors hover:border-border hover:bg-card/80",
        task.status === "done" && "opacity-70",
      )}
      data-testid="tasks-card"
    >
      <button
        aria-label={`Open ${task.title}`}
        className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        draggable
        onClick={onOpen}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, task.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        type="button"
      />
      <p
        className={cn(
          "pointer-events-none line-clamp-2 text-sm font-medium leading-snug",
          task.status === "done" &&
            "line-through decoration-muted-foreground/60",
        )}
      >
        {task.title}
      </p>
      {task.description ? (
        <p className="pointer-events-none mt-1 line-clamp-2 text-xs text-muted-foreground">
          {task.description}
        </p>
      ) : null}
      {assigneeId || question ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {assigneeId ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  accentDotClass(assignee?.accent),
                )}
              />
              {assigneeName ?? assigneeId}
            </span>
          ) : null}
          {question ? (
            <button
              className="relative inline-flex"
              onClick={onOpenAskMe}
              title={question}
              type="button"
            >
              <Badge className="gap-1" variant="warning">
                <MessageCircleQuestion className="h-3 w-3" />
                Asks you
              </Badge>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
