import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  NotebookPen,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  canRemoveMyTasks,
  type MyTask,
  type MyTaskStatus,
} from "@/features/tasks/lib/myTasks";
import {
  useMyMap,
  useMyTaskActions,
  useMyTasks,
} from "@/features/tasks/lib/useTasksData";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

const STATUS_STYLE: Record<MyTaskStatus, string> = {
  "To do": "bg-muted text-muted-foreground",
  Doing: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  Done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};
const NEXT_STATUS: Record<MyTaskStatus, MyTaskStatus> = {
  "To do": "Doing",
  Doing: "Done",
  Done: "To do",
};

function dueLabel(
  due: string | null,
): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const date = new Date(`${due.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { text: due, overdue: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  const text =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
  return { text, overdue: days < 0 };
}

/** Your own task sheet: the "My tasks" database in Notion, edited here. */
export function MyTasksSheet({ myDb }: { myDb: string }) {
  const { data: tasks = [], isLoading, error } = useMyTasks(myDb);
  const { add } = useMyTaskActions(myDb);
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");
  const [showDone, setShowDone] = React.useState(false);
  const open = tasks.filter((task) => task.status !== "Done");
  const done = tasks.filter((task) => task.status === "Done");

  const addTask = (event: React.FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    add.mutate(
      { title: value, due: due || null },
      {
        onSuccess: () => {
          setTitle("");
          setDue("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <div className="grid gap-4" data-testid="my-tasks">
      <form
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card/80 p-2 shadow-xs"
        onSubmit={addTask}
      >
        <Plus className="ml-2 h-4 w-4 text-muted-foreground" />
        <Input
          className="h-9 min-w-48 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          data-testid="my-tasks-add-title"
          disabled={add.isPending}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task for yourself"
          value={title}
        />
        <Input
          aria-label="Due date"
          className="h-8 w-40"
          onChange={(event) => setDue(event.target.value)}
          type="date"
          value={due}
        />
        <Button
          data-testid="my-tasks-add"
          disabled={!title.trim() || add.isPending}
          size="sm"
          type="submit"
        >
          {add.isPending ? <Loader2 className="animate-spin" /> : null}
          Add
        </Button>
      </form>

      {error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading your tasks from Notion…
        </div>
      ) : open.length === 0 && done.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing on your list. Tasks you add here, or in Notion, show up here.
        </p>
      ) : (
        <div className="grid gap-1">
          {open.map((task) => (
            <MyTaskRow key={task.id} myDb={myDb} task={task} />
          ))}
          {open.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              All done.
            </p>
          ) : null}
        </div>
      )}

      {done.length > 0 ? (
        <div className="grid gap-1">
          <button
            className="flex items-center gap-1 px-1 text-left"
            onClick={() => setShowDone((value) => !value)}
            type="button"
          >
            {showDone ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <SubsectionLabel>Done · {done.length}</SubsectionLabel>
          </button>
          {showDone
            ? done.map((task) => (
                <MyTaskRow key={task.id} myDb={myDb} task={task} />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function MyTaskRow({ task, myDb }: { task: MyTask; myDb: string }) {
  const { update, trash, restore } = useMyTaskActions(myDb);
  const removable = canRemoveMyTasks(useMyMap());
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(task.title);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [notes, setNotes] = React.useState(task.notes);
  const isDone = task.status === "Done";
  const dueInfo = dueLabel(task.due);

  React.useEffect(() => setTitle(task.title), [task.title]);
  React.useEffect(() => setNotes(task.notes), [task.notes]);

  const onError = (e: Error) => toast.error(e.message);
  const commitTitle = () => {
    setEditing(false);
    const value = title.trim();
    if (!value || value === task.title) {
      setTitle(task.title);
      return;
    }
    update.mutate({ id: task.id, patch: { title: value } }, { onError });
  };

  return (
    <div
      className="group rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/40"
      data-testid="my-task-row"
    >
      <div className="flex items-center gap-3">
        <Checkbox
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          checked={isDone}
          onCheckedChange={(checked) =>
            update.mutate(
              { id: task.id, patch: { status: checked ? "Done" : "To do" } },
              { onError },
            )
          }
        />
        {editing ? (
          <Input
            autoFocus
            className="h-8 flex-1"
            onBlur={commitTitle}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTitle();
              if (event.key === "Escape") {
                setTitle(task.title);
                setEditing(false);
              }
            }}
            value={title}
          />
        ) : (
          <button
            className={cn(
              "min-w-0 flex-1 truncate text-left text-sm",
              isDone && "text-muted-foreground line-through",
              !task.title && "italic text-muted-foreground",
            )}
            onClick={() => setEditing(true)}
            type="button"
          >
            {task.title || "Untitled"}
          </button>
        )}
        {dueInfo ? (
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums text-muted-foreground",
              dueInfo.overdue && !isDone && "text-destructive",
            )}
          >
            {dueInfo.text}
          </span>
        ) : null}
        <button
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            STATUS_STYLE[task.status],
          )}
          onClick={() =>
            update.mutate(
              { id: task.id, patch: { status: NEXT_STATUS[task.status] } },
              { onError },
            )
          }
          title="Change status"
          type="button"
        >
          {task.status}
        </button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            aria-label="Notes"
            className={cn(task.notes && "text-foreground")}
            onClick={() => setNotesOpen((value) => !value)}
            size="icon-xs"
            variant="ghost"
          >
            <NotebookPen />
          </Button>
          <Button
            aria-label="Open in Notion"
            onClick={() => void openUrl(task.url)}
            size="icon-xs"
            variant="ghost"
          >
            <ExternalLink />
          </Button>
          {removable ? (
            <Button
              aria-label="Remove from the list"
              onClick={() =>
                trash.mutate(task.id, {
                  onError,
                  onSuccess: () =>
                    toast("Removed (archived in Notion)", {
                      action: {
                        label: "Undo",
                        onClick: () =>
                          restore.mutate(
                            { id: task.id, status: task.status },
                            { onError },
                          ),
                      },
                    }),
                })
              }
              size="icon-xs"
              title="Remove from the list (it's archived in Notion, not deleted)"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>
      {notesOpen ? (
        <Textarea
          autoFocus
          className="mt-2 min-h-20 text-sm"
          onBlur={() => {
            if (notes !== task.notes) {
              update.mutate({ id: task.id, patch: { notes } }, { onError });
            }
          }}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes"
          value={notes}
        />
      ) : task.notes ? (
        <p className="ml-7 mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {task.notes}
        </p>
      ) : null}
    </div>
  );
}
