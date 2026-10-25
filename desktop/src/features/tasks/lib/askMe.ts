import type { OfficeTask } from "@/features/tasks/lib/useTasksData";

/**
 * What the Inbox asks you, by the Office's own rules: a task waits on you
 * when it's blocked, with an unanswered question or none at all (often it
 * waits on an approval nobody wrote down as a question), until you reply or
 * dismiss it; newest ask first; and with it, the open tasks stuck behind it.
 */

type Ask = NonNullable<OfficeTask["humanQA"]>[number];

/** The task's open question, if any (the latest unanswered, undismissed one). */
export function openQuestion(task: OfficeTask): Ask | undefined {
  const qa = task.humanQA ?? [];
  for (let i = qa.length - 1; i >= 0; i--) {
    const entry = qa[i];
    if (
      entry &&
      typeof entry.q === "string" &&
      !entry.a &&
      !entry.dismissedAt
    ) {
      return entry;
    }
  }
  return undefined;
}

/** Whether you've already replied to (or dismissed) a blocked task that has
 *  no open question: its latest entry is settled. */
function settled(task: OfficeTask): boolean {
  const last = task.humanQA?.at(-1);
  return !!last && (!!last.a || !!last.dismissedAt);
}

export function waitsOnYou(task: OfficeTask): boolean {
  return task.status === "blocked" && (!!openQuestion(task) || !settled(task));
}

function askedAtMs(task: OfficeTask): number | null {
  const at = openQuestion(task)?.askedAt ?? task.createdAt;
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/** Tasks waiting on you, newest ask first; asks with no time go last. */
export function asksForYou(tasks: OfficeTask[]): OfficeTask[] {
  return tasks.filter(waitsOnYou).sort((a, b) => {
    const at = askedAtMs(a);
    const bt = askedAtMs(b);
    if (at === null && bt === null) return 0;
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  });
}

/** Open tasks waiting (directly or down the chain) on `id`, each once. */
export function stuckBehind(id: string, tasks: OfficeTask[]): OfficeTask[] {
  const found = new Map<string, OfficeTask>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const task of tasks) {
      if (
        task.id !== id &&
        !found.has(task.id) &&
        task.status !== "done" &&
        (task.dependsOn ?? []).includes(current)
      ) {
        found.set(task.id, task);
        queue.push(task.id);
      }
    }
  }
  return [...found.values()];
}
