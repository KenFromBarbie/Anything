import { invoke } from "@tauri-apps/api/core";

/**
 * Notion for the Tasks page, through the owner's own Notion account: Buzz
 * signs in to Notion's hosted MCP server (OAuth in the browser; the tokens stay
 * in Buzz's Rust side and the OS keyring) and calls its tools. This module
 * shapes those calls and reads their results.
 *
 * The two task databases are referenced by their data sources
 * (`collection://…`), which is how Notion's tools address a database's rows.
 */

export type NotionConfig = {
  workspace?: string | null;
  parentPage?: string | null;
  /** The agents' board: a data source URL. */
  officeDb?: string | null;
  /** The owner's sheet: a data source URL. */
  myDb?: string | null;
  /** Its columns, when it's a database the owner already had. */
  myMap?: MyMap | null;
};

/** Which columns of the owner's sheet hold each field, and which of its
 *  status options mean To do / Doing / Done (and Archived, if it has one). */
export type MyMap = {
  name: string;
  status: string | null;
  due: string | null;
  notes: string | null;
  statuses: {
    todo: string;
    doing: string;
    done: string;
    archived: string | null;
  };
};

export type NotionStatus = {
  connected: boolean;
  workspace: string | null;
  user: string | null;
  config: NotionConfig;
};

type McpStatus = {
  connected: boolean;
  workspace?: string | null;
  user?: string | null;
};

export async function notionStatus(): Promise<NotionStatus> {
  const [mcp, stored] = await Promise.all([
    invoke<McpStatus>("notion_mcp_status"),
    invoke<{ config: NotionConfig }>("notion_status"),
  ]);
  return {
    connected: mcp.connected,
    workspace: mcp.workspace ?? null,
    user: mcp.user ?? null,
    config: stored.config ?? {},
  };
}

/** Opens Notion in the browser; resolves once the owner has approved. */
export const notionSignIn = () => invoke<McpStatus>("notion_mcp_sign_in");
export const notionCancelSignIn = () =>
  invoke<void>("notion_mcp_cancel_sign_in");
export const notionSaveConfig = (config: NotionConfig) =>
  invoke<void>("notion_save_config", { config });

/** Sign out and forget the task databases (they stay in Notion). */
export async function notionDisconnect(): Promise<void> {
  await invoke("notion_mcp_sign_out");
  await invoke("notion_disconnect");
}

export function callNotion<T = unknown>(
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  return invoke<T>("notion_mcp_call", { name: tool, arguments: args });
}

// ─── Reading tool results ────────────────────────────────────────────────────

const ID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/i;

/** A Notion id (dashed) from an id, URL or text. */
export function notionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ID_PATTERN.exec(value);
  if (!match) return null;
  const hex = match[0].replace(/-/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The plain text of a property value in any of the shapes Notion uses. */
export function plainValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(plainValue).join("");
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.plain_text === "string") return v.plain_text;
    if (typeof v.name === "string") return v.name;
    if (typeof v.start === "string") return v.start;
    for (const key of [
      "title",
      "rich_text",
      "select",
      "status",
      "text",
      "content",
      "date",
    ]) {
      if (key in v) return plainValue(v[key]);
    }
  }
  return "";
}

export type NotionRow = {
  pageId: string;
  url: string | null;
  values: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const v = asObject(value);
  if (!v) return [];
  for (const key of ["results", "rows", "pages", "data"]) {
    if (Array.isArray(v[key])) return v[key] as unknown[];
  }
  return [];
}

function toRow(raw: unknown): NotionRow | null {
  const row = asObject(raw);
  if (!row) return null;
  const url = typeof row.url === "string" ? row.url : null;
  const pageId = notionId(row.id) ?? notionId(row.page_id) ?? notionId(url);
  if (!pageId) return null;
  const values = asObject(row.properties) ?? row;
  return { pageId, url, values };
}

/** A property's text, by name. */
export function rowText(row: NotionRow, name: string): string {
  return plainValue(row.values[name]).trim();
}

/** A date property's start (YYYY-MM-DD…), by name. */
export function rowDate(row: NotionRow, name: string): string | null {
  const flat = row.values[`date:${name}:start`];
  if (typeof flat === "string" && flat) return flat;
  const value = plainValue(row.values[name]);
  return value || null;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** A date property in Notion's tool format (null clears it). */
export function dateValue(
  name: string,
  iso: string | null,
): Record<string, unknown> {
  return iso
    ? {
        [`date:${name}:start`]: iso.slice(0, 10),
        [`date:${name}:is_datetime`]: 0,
      }
    : { [`date:${name}:start`]: null };
}

/** Every row of a data source (up to Notion's 100 per query). */
export async function queryRows(dataSource: string): Promise<NotionRow[]> {
  const result = await callNotion("notion-query-data-sources", {
    data: { mode: "rows", data_source_url: dataSource, limit: 100 },
  });
  return rowsOf(result)
    .map(toRow)
    .filter((row): row is NotionRow => row !== null);
}

/** Add a row; returns its page id. */
export async function createRow(
  dataSource: string,
  properties: Record<string, unknown>,
): Promise<string> {
  const result = await callNotion("notion-create-pages", {
    parent: {
      type: "data_source_id",
      data_source_id: dataSource.replace(/^collection:\/\//, ""),
    },
    pages: [{ properties }],
    allow_async: false,
  });
  const created = rowsOf(result)[0] ?? result;
  const id =
    toRow(created)?.pageId ??
    notionId(typeof result === "string" ? result : JSON.stringify(result));
  if (!id) throw new Error("Notion didn't say which page it created.");
  return id;
}

export async function updateRow(
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await callNotion("notion-update-page", {
    page_id: pageId,
    command: "update_properties",
    properties,
    allow_async: false,
  });
}

// ─── Pages and databases ─────────────────────────────────────────────────────

/** Pages to put the task databases under (or databases, for an existing
 *  task list). */
export async function searchPages(
  query: string,
  kind: "page" | "database" = "page",
): Promise<{ id: string; title: string }[]> {
  const result = await callNotion("notion-search", {
    query: query || (kind === "database" ? "tasks" : "a"),
  });
  const pages: { id: string; title: string }[] = [];
  for (const raw of rowsOf(result)) {
    const item = asObject(raw);
    if (!item) continue;
    if (String(item.type ?? item.object ?? "page") !== kind) continue;
    const id = notionId(item.id) ?? notionId(item.url);
    if (!id) continue;
    pages.push({ id, title: plainValue(item.title) || "Untitled" });
  }
  return pages;
}

/** The agents' board: one row per task, keyed by "Task ID". */
export const OFFICE_DB = {
  name: "Name",
  status: "Status",
  assignee: "Assignee",
  description: "Description",
  taskId: "Task ID",
} as const;

/** The owner's own sheet. */
export const MY_DB = {
  name: "Name",
  status: "Status",
  due: "Due",
  notes: "Notes",
} as const;

/** Rows set to this are hidden (Notion's tools can't trash a page). */
export const ARCHIVED = "Archived";
export const OFFICE_STATUSES = [
  "To do",
  "Doing",
  "Blocked",
  "Done",
  ARCHIVED,
] as const;
export const MY_STATUSES = ["To do", "Doing", "Done", ARCHIVED] as const;

const COLORS: Record<string, string> = {
  Done: "green",
  Doing: "blue",
  Blocked: "red",
  [ARCHIVED]: "brown",
};

/** A CREATE TABLE select column with these options. */
const selectColumn = (names: readonly string[]) =>
  `SELECT(${names.map((name) => `'${name}':${COLORS[name] ?? "gray"}`).join(", ")})`;

const COLLECTION = /collection:\/\/[0-9a-f-]{32,36}/i;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  const text = asObject(value)?.text;
  return typeof text === "string" ? text : JSON.stringify(value);
}

/** The data source of a database (from a create or fetch result). */
async function dataSourceOf(created: unknown): Promise<string> {
  const text = textOf(created);
  const direct = COLLECTION.exec(text);
  if (direct) return direct[0];
  const id = notionId(text);
  if (!id) throw new Error("Notion didn't say which database it created.");
  const found = COLLECTION.exec(
    textOf(await callNotion("notion-fetch", { id })),
  );
  if (!found) {
    throw new Error(
      "That database's rows can't be reached through Notion's tools (linked views and the Home \"My tasks\" widget can't be used). Pick the original database.",
    );
  }
  return found[0];
}

/** Create the databases Buzz needs under a page the owner picked. The agents'
 *  board is always new; the owner's sheet is new unless they chose one. */
export async function createTaskDatabases(
  parentPageId: string,
  existingMine?: { dataSource: string; map: MyMap } | null,
): Promise<NotionConfig> {
  const create = async (title: string, schema: string) =>
    dataSourceOf(
      await callNotion("notion-create-database", {
        parent: { type: "page_id", page_id: parentPageId },
        title,
        schema,
      }),
    );
  const officeDb = await create(
    "Office tasks",
    `CREATE TABLE ("${OFFICE_DB.name}" TITLE, "${OFFICE_DB.status}" ${selectColumn(OFFICE_STATUSES)}, "${OFFICE_DB.assignee}" RICH_TEXT, "${OFFICE_DB.description}" RICH_TEXT, "${OFFICE_DB.taskId}" RICH_TEXT)`,
  );
  const myDb =
    existingMine?.dataSource ??
    (await create(
      "My tasks",
      `CREATE TABLE ("${MY_DB.name}" TITLE, "${MY_DB.status}" ${selectColumn(MY_STATUSES)}, "${MY_DB.due}" DATE, "${MY_DB.notes}" RICH_TEXT)`,
    ));
  const config: NotionConfig = {
    parentPage: parentPageId,
    officeDb,
    myDb,
    myMap: existingMine?.map ?? null,
  };
  await notionSaveConfig(config);
  return config;
}

/** Switch the owner's sheet to a database they already have. */
export async function adoptMyDb(dataSource: string, map: MyMap): Promise<void> {
  await notionSaveConfig({ myDb: dataSource, myMap: map });
}

export type NotionColumn = { name: string; type: string; options: string[] };

/** A database's data source and columns, for using it as the owner's sheet. */
export async function inspectDatabase(
  databaseId: string,
): Promise<{ dataSource: string; columns: NotionColumn[] }> {
  const dataSource = await dataSourceOf(
    await callNotion("notion-fetch", { id: databaseId }),
  );
  const text = textOf(await callNotion("notion-fetch", { id: dataSource }));
  const state = /<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/.exec(
    text,
  );
  let schema: Record<string, unknown> = {};
  try {
    schema = asObject(asObject(JSON.parse(state?.[1] ?? "{}"))?.schema) ?? {};
  } catch {
    schema = {};
  }
  const columns = Object.values(schema)
    .map(asObject)
    .filter((c): c is Record<string, unknown> => c !== null)
    .map((c) => ({
      name: String(c.name ?? ""),
      type: String(c.type ?? ""),
      options: Array.isArray(c.options)
        ? c.options.map((o) => String(asObject(o)?.name ?? "")).filter(Boolean)
        : [],
    }))
    .filter((c) => c.name);
  if (columns.length === 0) {
    throw new Error("Couldn't read that database's columns.");
  }
  return { dataSource, columns };
}

/** The best guess at which columns of an existing database are which. */
export function guessMyMap(columns: NotionColumn[]): MyMap | null {
  const title = columns.find((c) => c.type === "title");
  if (!title) return null;
  const named = (types: string[], pattern: RegExp) =>
    columns.find((c) => types.includes(c.type) && pattern.test(c.name)) ??
    columns.find((c) => types.includes(c.type)) ??
    null;
  const status = named(["status", "select"], /status|state|stage/i);
  const due = named(["date"], /due|deadline|date|when/i);
  const notes =
    columns.find(
      (c) =>
        (c.type === "text" || c.type === "rich_text") &&
        /note|description|detail|summary/i.test(c.name),
    ) ?? null;
  const options = status?.options ?? [];
  const pick = (pattern: RegExp, fallback: string) =>
    options.find((o) => pattern.test(o)) ?? fallback;
  return {
    name: title.name,
    status: status?.name ?? null,
    due: due?.name ?? null,
    notes: notes?.name ?? null,
    statuses: {
      todo: pick(/to.?do|not started|backlog|open/i, options[0] ?? "To do"),
      doing: pick(
        /progress|doing|started|active|working/i,
        options[1] ?? "Doing",
      ),
      done: pick(/done|complete|finished|closed/i, options.at(-1) ?? "Done"),
      archived: options.find((o) => /archiv/i.test(o)) ?? null,
    },
  };
}

/** The column map of the sheet Buzz creates. */
export const DEFAULT_MY_MAP: MyMap = {
  name: MY_DB.name,
  status: MY_DB.status,
  due: MY_DB.due,
  notes: MY_DB.notes,
  statuses: { todo: "To do", doing: "Doing", done: "Done", archived: ARCHIVED },
};

/** A Notion page or database link from an id or data source URL. */
export function notionUrl(idOrUrl: string): string {
  const id = notionId(idOrUrl);
  return `https://www.notion.so/${(id ?? idOrUrl).replace(/-/g, "")}`;
}
