import { invoke } from "@tauri-apps/api/core";

import { callOffice, getOfficeAgents } from "@/features/office/lib/officeLink";
import { agentIdForName, agentLabel } from "@/features/tasks/lib/agentNames";
import {
  ARCHIVED,
  createRow,
  type NotionRow,
  OFFICE_DB,
  queryRows,
  rowText,
  updateRow,
} from "@/features/tasks/lib/notion";
import {
  type BoardTask,
  type Names,
  planInbound,
  rowFingerprint,
  type SyncEntry,
  type SyncState,
  type TaskRow,
  taskFingerprint,
  toNotionStatus,
} from "@/features/tasks/lib/notionSyncPlan";

/**
 * Carries out `planInbound`: the owner's rows in the "Office tasks" database
 * become (and update) tasks on the Office's board, one way. One run at a time; writes are spaced to stay
 * under Notion's rate limit. A failed write keeps its last good bookkeeping, so
 * the next run retries it.
 */

export type SyncResult = {
  created: number;
  updated: number;
  imported: number;
  archived: number;
  failed: number;
  at: number;
};

const WRITE_GAP_MS = 350;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function agentNames(): Names {
  const agents = getOfficeAgents().agents;
  return {
    nameOf: (id) => agentLabel(id, agents),
    idOf: (name) => agentIdForName(name, agents),
  };
}

function toRow(row: NotionRow): TaskRow {
  return {
    pageId: row.pageId,
    taskId: rowText(row, OFFICE_DB.taskId) || null,
    title: rowText(row, OFFICE_DB.name),
    status: rowText(row, OFFICE_DB.status) || null,
    assignee: rowText(row, OFFICE_DB.assignee),
    description: rowText(row, OFFICE_DB.description),
  };
}

function rowProperties(task: BoardTask, names: Names) {
  const assignee = task.assignee
    ? (names.nameOf(task.assignee) ?? task.assignee)
    : "";
  return {
    [OFFICE_DB.name]: task.title.slice(0, 2000),
    [OFFICE_DB.status]: toNotionStatus(task.status),
    [OFFICE_DB.assignee]: assignee,
    [OFFICE_DB.description]: (task.description ?? "").slice(0, 2000),
    [OFFICE_DB.taskId]: task.id,
  };
}

function readState(raw: unknown): SyncState {
  const tasks =
    raw && typeof raw === "object" && "tasks" in raw
      ? (raw as { tasks: unknown }).tasks
      : null;
  return {
    tasks:
      tasks && typeof tasks === "object"
        ? (tasks as Record<string, SyncEntry>)
        : {},
  };
}

async function runSync(officeDb: string): Promise<SyncResult> {
  const names = agentNames();
  const [allTasks, allRows, rawState] = await Promise.all([
    callOffice<BoardTask[]>("tasks.list"),
    queryRows(officeDb),
    invoke<unknown>("notion_sync_state_load"),
  ]);
  const state = readState(rawState);
  const next: SyncState = { tasks: {} };
  // Rows archived in Notion (Notion's tools can't trash a page, so taking a
  // row off sets its status to Archived) are left alone, and so are their
  // tasks: a row archived in Notion never deletes a task, and isn't recreated.
  const rows = allRows.map(toRow);
  const archivedPages = new Set(
    rows.filter((r) => r.status === ARCHIVED).map((r) => r.pageId),
  );
  const tasks = allTasks.filter((task) => {
    const entry = state.tasks[task.id];
    if (entry && archivedPages.has(entry.pageId)) {
      next.tasks[task.id] = entry;
      return false;
    }
    return true;
  });
  const actions = planInbound(
    tasks,
    rows.filter((r) => !archivedPages.has(r.pageId)),
    {
      tasks: Object.fromEntries(
        Object.entries(state.tasks).filter(
          ([, e]) => !archivedPages.has(e.pageId),
        ),
      ),
    },
    names,
  );
  const result: SyncResult = {
    created: 0,
    updated: 0,
    imported: 0,
    archived: 0,
    failed: 0,
    at: Date.now(),
  };
  let wrote = false;
  const write = async <T>(run: () => Promise<T>) => {
    if (wrote) await wait(WRITE_GAP_MS);
    wrote = true;
    return run();
  };

  for (const action of actions) {
    try {
      switch (action.kind) {
        case "in-sync":
          next.tasks[action.taskId] = action.entry;
          break;
        case "create-row": {
          const pageId = await write(() =>
            createRow(officeDb, rowProperties(action.task, names)),
          );
          const fp = taskFingerprint(action.task, names);
          next.tasks[action.task.id] = {
            pageId,
            localFp: fp,
            notionFp: fp,
          };
          result.created++;
          break;
        }
        case "update-row": {
          await write(() =>
            updateRow(action.pageId, rowProperties(action.task, names)),
          );
          const fp = taskFingerprint(action.task, names);
          next.tasks[action.task.id] = {
            pageId: action.pageId,
            localFp: fp,
            notionFp: fp,
          };
          result.updated++;
          break;
        }
        case "update-task": {
          const { patch } = action;
          await callOffice("tasks.patch", {
            id: action.taskId,
            patch: {
              ...patch,
              assignee: patch.assignee ?? "",
              description: patch.description ?? "",
            },
          });
          const task = tasks.find((t) => t.id === action.taskId);
          next.tasks[action.taskId] = {
            pageId: action.row.pageId,
            localFp: task
              ? taskFingerprint({ ...task, ...patch }, names)
              : rowFingerprint(action.row),
            notionFp: rowFingerprint(action.row),
          };
          result.updated++;
          break;
        }
        case "import-row": {
          const { row } = action;
          const task = await callOffice<BoardTask>("tasks.add", {
            title: row.title.trim() || "Untitled",
            status: patchStatus(row),
            assignee: row.assignee.trim()
              ? (names.idOf(row.assignee) ?? row.assignee.trim())
              : "",
            description: row.description,
          });
          // Paired here (nothing is written back to Notion), so the row
          // isn't imported again.
          next.tasks[task.id] = {
            pageId: row.pageId,
            localFp: taskFingerprint(task, names),
            notionFp: rowFingerprint(row),
          };
          result.imported++;
          break;
        }
        case "archive-row":
          // The task left the board: its row is marked Archived (it stays in
          // Notion, out of the way).
          await write(() =>
            updateRow(action.pageId, { [OFFICE_DB.status]: ARCHIVED }),
          );
          result.archived++;
          break;
      }
    } catch (error) {
      result.failed++;
      console.warn("[notion-sync]", action.kind, error);
      const key =
        action.kind === "create-row" || action.kind === "update-row"
          ? action.task.id
          : action.kind === "import-row"
            ? null
            : action.taskId;
      if (key && state.tasks[key] && !next.tasks[key]) {
        next.tasks[key] = state.tasks[key];
      }
    }
  }

  await invoke("notion_sync_state_save", { state: next });
  return result;
}

function patchStatus(row: TaskRow): BoardTask["status"] {
  const status = (row.status ?? "").toLowerCase();
  if (status === "doing") return "doing";
  if (status === "blocked") return "blocked";
  if (status === "done") return "done";
  return "todo";
}

let running: Promise<SyncResult> | null = null;
let last: SyncResult | null = null;
let lastError: string | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Sync the board with Notion now (joins a run already going). */
export function syncOfficeTasks(officeDb: string): Promise<SyncResult> {
  if (running) return running;
  notify();
  running = runSync(officeDb)
    .then((result) => {
      last = result;
      lastError = null;
      return result;
    })
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => {
      running = null;
      notify();
    });
  notify();
  return running;
}

export type SyncStatus = {
  running: boolean;
  last: SyncResult | null;
  error: string | null;
};

let snapshot: SyncStatus = { running: false, last: null, error: null };

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  if (
    snapshot.running !== !!running ||
    snapshot.last !== last ||
    snapshot.error !== lastError
  ) {
    snapshot = { running: !!running, last, error: lastError };
  }
  return snapshot;
}
