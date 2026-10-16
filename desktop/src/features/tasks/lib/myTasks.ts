import {
  createRow,
  dateValue,
  type MyMap,
  type NotionRow,
  notionUrl,
  queryRows,
  rowDate,
  rowText,
  updateRow,
} from "@/features/tasks/lib/notion";

/** The owner's own sheet: a task database in Notion (the one Buzz made, or
 *  one they already had), read and written live through the owner's Notion
 *  sign-in. `map` says which of its columns hold which field. */

export type MyTaskStatus = "To do" | "Doing" | "Done";

export type MyTask = {
  id: string;
  url: string;
  title: string;
  status: MyTaskStatus;
  due: string | null;
  notes: string;
};

/** Our status as the sheet's own option name. */
function toSheetStatus(map: MyMap, status: MyTaskStatus): string {
  if (status === "Doing") return map.statuses.doing;
  if (status === "Done") return map.statuses.done;
  return map.statuses.todo;
}

/** The sheet's option name as our status (anything unknown counts as To do). */
function fromSheetStatus(map: MyMap, value: string): MyTaskStatus {
  if (value === map.statuses.done) return "Done";
  if (value === map.statuses.doing) return "Doing";
  return "To do";
}

function toMyTask(map: MyMap, row: NotionRow): MyTask {
  return {
    id: row.pageId,
    url: row.url ?? notionUrl(row.pageId),
    title: rowText(row, map.name),
    status: map.status
      ? fromSheetStatus(map, rowText(row, map.status))
      : "To do",
    due: map.due ? rowDate(row, map.due) : null,
    notes: map.notes ? rowText(row, map.notes) : "",
  };
}

/** The sheet, as Notion returns it; archived rows are left out. */
export async function listMyTasks(myDb: string, map: MyMap): Promise<MyTask[]> {
  const rows = await queryRows(myDb);
  return rows
    .filter(
      (row) =>
        !map.status ||
        !map.statuses.archived ||
        rowText(row, map.status) !== map.statuses.archived,
    )
    .map((row) => toMyTask(map, row));
}

export async function addMyTask(
  myDb: string,
  map: MyMap,
  fields: { title: string; due?: string | null; notes?: string },
): Promise<MyTask> {
  const properties: Record<string, unknown> = { [map.name]: fields.title };
  if (map.status) properties[map.status] = toSheetStatus(map, "To do");
  if (map.notes && fields.notes) properties[map.notes] = fields.notes;
  if (map.due && fields.due)
    Object.assign(properties, dateValue(map.due, fields.due));
  const id = await createRow(myDb, properties);
  return {
    id,
    url: notionUrl(id),
    title: fields.title,
    status: "To do",
    due: fields.due ?? null,
    notes: fields.notes ?? "",
  };
}

export async function updateMyTask(
  map: MyMap,
  pageId: string,
  patch: Partial<Pick<MyTask, "title" | "status" | "due" | "notes">>,
): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (patch.title !== undefined) properties[map.name] = patch.title;
  if (patch.status !== undefined && map.status)
    properties[map.status] = toSheetStatus(map, patch.status);
  if (patch.notes !== undefined && map.notes)
    properties[map.notes] = patch.notes;
  if (patch.due !== undefined && map.due)
    Object.assign(properties, dateValue(map.due, patch.due));
  if (Object.keys(properties).length > 0) await updateRow(pageId, properties);
}

/** Whether tasks can be taken off this sheet (it needs an Archived option;
 *  Notion's tools can't delete pages). */
export const canRemoveMyTasks = (map: MyMap) =>
  !!map.status && !!map.statuses.archived;

/** Takes the task off the sheet (it stays in Notion, marked Archived). */
export async function trashMyTask(map: MyMap, pageId: string): Promise<void> {
  if (!map.status || !map.statuses.archived) {
    throw new Error("This sheet has no Archived status; remove it in Notion.");
  }
  await updateRow(pageId, { [map.status]: map.statuses.archived });
}

/** Puts an archived task back, with the status it had. */
export async function restoreMyTask(
  map: MyMap,
  pageId: string,
  status: MyTaskStatus,
): Promise<void> {
  if (!map.status) return;
  await updateRow(pageId, { [map.status]: toSheetStatus(map, status) });
}
