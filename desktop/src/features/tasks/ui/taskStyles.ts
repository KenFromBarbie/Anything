import type { OfficeTask } from "@/features/tasks/lib/useTasksData";

export const SELECT_CLASS =
  "flex h-9 rounded-lg border border-input/40 bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export const BOARD_COLUMNS: {
  status: OfficeTask["status"];
  label: string;
  dot: string;
}[] = [
  { status: "todo", label: "To do", dot: "bg-muted-foreground/50" },
  { status: "doing", label: "Doing", dot: "bg-blue-500" },
  { status: "blocked", label: "Blocked", dot: "bg-red-500" },
  { status: "done", label: "Done", dot: "bg-emerald-500" },
];

/** The question an agent is waiting on you for, if any. */
export function openQuestion(task: OfficeTask): string | null {
  const open = [...(task.humanQA ?? [])]
    .reverse()
    .find((entry) => !entry.a && !entry.dismissedAt);
  return open?.q ?? null;
}
