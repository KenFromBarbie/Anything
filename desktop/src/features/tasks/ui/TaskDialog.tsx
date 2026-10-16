import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { agentLabel } from "@/features/tasks/lib/agentNames";
import {
  type OfficeTask,
  useOfficeTaskActions,
} from "@/features/tasks/lib/useTasksData";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

import { BOARD_COLUMNS, SELECT_CLASS } from "./taskStyles";

type Draft = Pick<OfficeTask, "title" | "description" | "status" | "assignee">;

const draftOf = (task: OfficeTask): Draft => ({
  title: task.title,
  description: task.description ?? "",
  status: task.status,
  assignee: task.assignee ?? "",
});

/** One task of the board: edit it, move it, hand it to another agent. */
export function TaskDialog({
  task,
  agents,
  onOpenChange,
}: {
  task: OfficeTask | null;
  agents: OfficeAgent[];
  onOpenChange: (open: boolean) => void;
}) {
  const { patch, remove } = useOfficeTaskActions();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const taskId = task?.id ?? null;

  // A fresh draft each time a task opens; the board refreshing underneath
  // doesn't overwrite edits in progress.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the task id
  React.useEffect(() => {
    setDraft(task ? draftOf(task) : null);
  }, [taskId]);

  const assigneeKnown =
    !draft?.assignee || agents.some((agent) => agent.id === draft.assignee);
  const qa = task?.humanQA ?? [];

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!task || !draft) return;
    const title = draft.title.trim();
    if (!title) return;
    patch.mutate(
      {
        id: task.id,
        patch: {
          title,
          description: draft.description?.trim() ?? "",
          status: draft.status,
          assignee: draft.assignee ?? "",
        },
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const deleteTask = () => {
    if (!task) return;
    remove.mutate(task.id, {
      onSuccess: () => {
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={!!task && !!draft}>
        <DialogContent className="max-w-xl" data-testid="tasks-dialog">
          {task && draft ? (
            <form className="grid gap-4" onSubmit={save}>
              <DialogHeader>
                <DialogTitle>Task</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {task.id}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="task-title">
                  Title
                </label>
                <Input
                  id="task-title"
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  value={draft.title}
                />
              </div>
              <div className="grid gap-1.5">
                <label
                  className="text-sm font-medium"
                  htmlFor="task-description"
                >
                  Description
                </label>
                <Textarea
                  className="min-h-28"
                  id="task-description"
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  value={draft.description}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="task-status">
                    Status
                  </label>
                  <select
                    className={SELECT_CLASS}
                    id="task-status"
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        status: event.target.value as OfficeTask["status"],
                      })
                    }
                    value={draft.status}
                  >
                    {BOARD_COLUMNS.map((column) => (
                      <option key={column.status} value={column.status}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <label
                    className="text-sm font-medium"
                    htmlFor="task-assignee"
                  >
                    Assignee
                  </label>
                  <select
                    className={SELECT_CLASS}
                    id="task-assignee"
                    onChange={(event) =>
                      setDraft({ ...draft, assignee: event.target.value })
                    }
                    value={draft.assignee}
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                    {assigneeKnown ? null : (
                      <option value={draft.assignee}>
                        {agentLabel(draft.assignee ?? "", agents)} (not on the
                        floor)
                      </option>
                    )}
                  </select>
                </div>
              </div>
              {qa.length > 0 ? (
                <div className="grid gap-2">
                  <SubsectionLabel>Questions for you</SubsectionLabel>
                  <ul className="grid gap-2">
                    {qa.map((entry, index) => (
                      <li
                        className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm"
                        // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
                        key={index}
                      >
                        <p>{entry.q}</p>
                        <p className="mt-1 text-muted-foreground">
                          {entry.a
                            ? entry.a
                            : entry.dismissedAt
                              ? "Dismissed"
                              : "Waiting for your answer in Ask Me"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
                <Button
                  data-testid="tasks-dialog-delete"
                  onClick={() => setConfirmDelete(true)}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button
                    onClick={() => onOpenChange(false)}
                    type="button"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    data-testid="tasks-dialog-save"
                    disabled={!draft.title.trim() || patch.isPending}
                    type="submit"
                  >
                    {patch.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    Save
                  </Button>
                </div>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog onOpenChange={setConfirmDelete} open={confirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              “{task?.title}” comes off the agents' board. If Notion is
              connected, its row moves to Notion's trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                data-testid="tasks-dialog-delete-confirm"
                disabled={remove.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  deleteTask();
                }}
                variant="destructive"
              >
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
