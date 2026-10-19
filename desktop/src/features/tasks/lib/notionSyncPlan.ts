/**
 * The two-way sync between the Office's task board and its Notion database,
 * as a pure decision: given both sides and what they looked like when they
 * last matched, what to change. `notionSync` carries the decisions out.
 *
 *  - a task with no row gets one; a row with no task (added in Notion) becomes
 *    a task;
 *  - when one side changed since the last sync, it updates the other; when both
 *    did, the board wins (agents are working from it);
 *  - a task removed from the board archives its row. Rows archived or deleted
 *    in Notion don't delete tasks: the board's agents own that.
 */

export type BoardStatus = "todo" | "doing" | "blocked" | "done";

export type BoardTask = {
  id: string;
  title: string;
  status: BoardStatus;
  description?: string;
  assignee?: string;
};

/** A row of the Notion database, already read out of Notion's properties. */
export type TaskRow = {
  pageId: string;
  taskId: string | null;
  title: string;
  status: string | null;
  /** As written in Notion: an agent's name. */
  assignee: string;
  description: string;
};

export type SyncEntry = { pageId: string; localFp: string; notionFp: string };
export type SyncState = { tasks: Record<string, SyncEntry> };

export type SyncAction =
  | { kind: "create-row"; task: BoardTask }
  | { kind: "update-row"; task: BoardTask; pageId: string }
  | {
      kind: "update-task";
      taskId: string;
      patch: Partial<BoardTask>;
      row: TaskRow;
    }
  | { kind: "import-row"; row: TaskRow }
  | { kind: "archive-row"; taskId: string; pageId: string }
  | { kind: "in-sync"; taskId: string; entry: SyncEntry };

const TO_NOTION: Record<BoardStatus, string> = {
  todo: "To do",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
};

export const toNotionStatus = (status: BoardStatus) => TO_NOTION[status];

export function fromNotionStatus(status: string | null): BoardStatus | null {
  const found = (Object.keys(TO_NOTION) as BoardStatus[]).find(
    (key) => TO_NOTION[key].toLowerCase() === (status ?? "").toLowerCase(),
  );
  return found ?? null;
}

export type Names = {
  /** An agent id to the name shown in Notion. */
  nameOf: (id: string) => string | undefined;
  /** A name typed in Notion back to an agent id. */
  idOf: (name: string) => string | undefined;
};

/** What both sides are compared on, in Notion's terms. */
function fingerprint(fields: {
  title: string;
  status: string;
  assignee: string;
  description: string;
}): string {
  return JSON.stringify([
    fields.title.trim(),
    fields.status,
    fields.assignee.trim(),
    fields.description.trim(),
  ]);
}

export function taskFingerprint(task: BoardTask, names: Names): string {
  return fingerprint({
    title: task.title,
    status: toNotionStatus(task.status),
    assignee: task.assignee
      ? (names.nameOf(task.assignee) ?? task.assignee)
      : "",
    description: task.description ?? "",
  });
}

export function rowFingerprint(row: TaskRow): string {
  return fingerprint({
    title: row.title,
    status: toNotionStatus(fromNotionStatus(row.status) ?? "todo"),
    assignee: row.assignee,
    description: row.description,
  });
}

/** The board fields a row carries, for updating a task from Notion. An
 *  assignee still showing the task's current agent keeps that agent, even one
 *  no longer on the floor. */
export function patchFromRow(
  row: TaskRow,
  names: Names,
  current?: BoardTask,
): Partial<BoardTask> {
  const assignee = row.assignee.trim();
  const unchanged =
    !!current?.assignee &&
    (names.nameOf(current.assignee) ?? current.assignee) === assignee;
  return {
    title: row.title.trim() || "Untitled",
    status: fromNotionStatus(row.status) ?? "todo",
    assignee: unchanged
      ? current?.assignee
      : assignee
        ? (names.idOf(assignee) ?? assignee)
        : undefined,
    description: row.description.trim() || undefined,
  };
}

export function planSync(
  tasks: BoardTask[],
  rows: TaskRow[],
  state: SyncState,
  names: Names,
): SyncAction[] {
  const actions: SyncAction[] = [];
  const rowByTaskId = new Map<string, TaskRow>();
  const rowByPageId = new Map<string, TaskRow>();
  for (const row of rows) {
    rowByPageId.set(row.pageId, row);
    if (row.taskId) rowByTaskId.set(row.taskId, row);
  }
  const taskIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    const entry = state.tasks[task.id];
    const row =
      rowByTaskId.get(task.id) ??
      (entry ? rowByPageId.get(entry.pageId) : undefined);
    const localFp = taskFingerprint(task, names);
    if (!row) {
      actions.push({ kind: "create-row", task });
      continue;
    }
    const notionFp = rowFingerprint(row);
    if (localFp === notionFp && row.taskId !== task.id) {
      // Matches, but the row doesn't name its task yet: stamp it.
      actions.push({ kind: "update-row", task, pageId: row.pageId });
      continue;
    }
    if (localFp === notionFp) {
      actions.push({
        kind: "in-sync",
        taskId: task.id,
        entry: { pageId: row.pageId, localFp, notionFp },
      });
      continue;
    }
    const localChanged = !entry || localFp !== entry.localFp;
    const notionChanged = !!entry && notionFp !== entry.notionFp;
    if (notionChanged && !localChanged) {
      actions.push({
        kind: "update-task",
        taskId: task.id,
        patch: patchFromRow(row, names, task),
        row,
      });
    } else {
      actions.push({ kind: "update-row", task, pageId: row.pageId });
    }
  }

  // A row already paired with a task (its Task ID not written yet) isn't new.
  const pairedPages = new Set(
    Object.values(state.tasks).map((entry) => entry.pageId),
  );
  for (const row of rows) {
    if (!row.taskId && !pairedPages.has(row.pageId)) {
      actions.push({ kind: "import-row", row });
    }
  }

  for (const [taskId, entry] of Object.entries(state.tasks)) {
    if (!taskIds.has(taskId) && rowByPageId.has(entry.pageId)) {
      actions.push({ kind: "archive-row", taskId, pageId: entry.pageId });
    }
  }
  return actions;
}

/**
 * One way, Notion to the board: the owner hands agents work by adding rows to
 * "Office tasks". New rows (no Task ID, not seen before) become tasks; edits
 * to a row in Notion update its task. Nothing on the board is written to
 * Notion: the agents' own workflow stays theirs, the owner's stays in Notion.
 */
export function planInbound(
  tasks: BoardTask[],
  rows: TaskRow[],
  state: SyncState,
  names: Names,
): SyncAction[] {
  const actions: SyncAction[] = [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskIdByPage = new Map(
    Object.entries(state.tasks).map(([taskId, entry]) => [
      entry.pageId,
      taskId,
    ]),
  );
  for (const row of rows) {
    const taskId =
      taskIdByPage.get(row.pageId) ??
      (row.taskId && taskById.has(row.taskId) ? row.taskId : null);
    if (!taskId) {
      // A row that names a task no longer on the board was the board's own
      // (written out before this went one way): never brought back.
      if (!row.taskId) actions.push({ kind: "import-row", row });
      continue;
    }
    const task = taskById.get(taskId);
    const entry = state.tasks[taskId];
    const notionFp = rowFingerprint(row);
    if (!task) {
      // Its task is done with and gone; remember the row so it isn't redone.
      if (entry) actions.push({ kind: "in-sync", taskId, entry });
      continue;
    }
    const localFp = taskFingerprint(task, names);
    if (entry && notionFp !== entry.notionFp) {
      actions.push({
        kind: "update-task",
        taskId,
        patch: patchFromRow(row, names, task),
        row,
      });
      continue;
    }
    actions.push({
      kind: "in-sync",
      taskId,
      entry: { pageId: row.pageId, localFp, notionFp },
    });
  }
  return actions;
}
