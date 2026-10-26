import { invoke } from "@tauri-apps/api/core";

import {
  keepLive,
  notionId,
  queryRows,
  rowText,
} from "@/features/tasks/lib/notion";

/**
 * Reading Notion in the app, through the owner's Notion sign-in: search and
 * list pages, and open one as text (Notion's tools return pages as
 * Notion-flavoured markdown with XML-ish tags, turned into plain markdown
 * here), with its path, the pages and databases inside it, and a database's
 * rows.
 */

export type NotionItem = {
  id: string;
  title: string;
  kind: "page" | "database";
  when?: string;
};

export type NotionDocument = {
  id: string;
  title: string;
  kind: "page" | "database";
  path: NotionItem[];
  markdown: string;
  children: NotionItem[];
  rows: NotionItem[];
};

const call = <T = unknown>(name: string, args: Record<string, unknown>) =>
  invoke<T>("notion_mcp_call", { name, arguments: args });

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text: unknown }).text;
    if (typeof text === "string") return text;
  }
  return JSON.stringify(value ?? "");
}

function itemsOf(value: unknown): NotionItem[] {
  const list =
    value && typeof value === "object" && "results" in value
      ? (value as { results: unknown }).results
      : value;
  if (!Array.isArray(list)) return [];
  const items: NotionItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = notionId(r.id) ?? notionId(r.url);
    if (!id) continue;
    const type = String(r.type ?? r.object ?? "page");
    items.push({
      id,
      title:
        typeof r.title === "string" && r.title.trim() ? r.title : "Untitled",
      kind: type === "database" || type === "data_source" ? "database" : "page",
      when: typeof r.timestamp === "string" ? r.timestamp : undefined,
    });
  }
  return items;
}

/** Pages and databases matching `query`; with no query, recent ones.
 *  Deleted ones are left out (search keeps listing them for a while). */
export async function listNotion(query: string): Promise<NotionItem[]> {
  const q = query.trim();
  if (!q) {
    try {
      const recent = itemsOf(await call("notion-list-recent-pages", {}));
      if (recent.length > 0) return keepLive(recent);
    } catch {
      // Not offered by this workspace: fall back to a broad search.
    }
  }
  return keepLive(itemsOf(await call("notion-search", { query: q || "a" })));
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Notion's tagged text as markdown. Child pages/databases become bold
 *  names (they're listed separately, as links). */
function toMarkdown(content: string): string {
  return decode(
    content
      .replace(
        /<(page|database)\s[^>]*>([\s\S]*?)<\/\1>/g,
        (_m, kind, title) =>
          `**${kind === "database" ? "🗂" : "📄"} ${title.trim()}**`,
      )
      .replace(/<callout[^>]*>([\s\S]*?)<\/callout>/g, (_m, inner) =>
        inner
          .trim()
          .split("\n")
          .map((line: string) => `> ${line.trim()}`)
          .join("\n"),
      )
      .replace(/<empty-block\s*\/>/g, "")
      .replace(/<image[^>]*source="([^"]+)"[^>]*\/?>(?:<\/image>)?/g, "![]($1)")
      .replace(
        /<mention-[a-z]+[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/mention-[a-z]+>/g,
        "[$2]($1)",
      )
      .replace(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/gi, "")
      .replace(/^\t+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

const TITLE_KEYS = ["title", "Title", "Name", "name", "Task name", "Page"];

function titleFromProperties(text: string): string | null {
  const raw = /<properties>\s*([\s\S]*?)\s*<\/properties>/.exec(text)?.[1];
  if (!raw) return null;
  try {
    const props = JSON.parse(raw) as Record<string, unknown>;
    for (const key of TITLE_KEYS) {
      const value = props[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function rowTitle(values: Record<string, unknown>): string {
  for (const key of TITLE_KEYS) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(values)) {
    if (typeof value === "string" && value.trim() && !/^https?:/.test(value)) {
      return value.trim().slice(0, 120);
    }
  }
  return "Untitled";
}

/** One page or database, ready to show. */
export async function openNotion(
  id: string,
  knownTitle?: string,
): Promise<NotionDocument> {
  const text = textOf(await call("notion-fetch", { id }));
  const isDatabase =
    /The title of this Database is:/.test(text) ||
    /^[^\n]*<database url=/m.test(text.slice(0, 400));
  const title =
    /The title of this (?:Database|Page) is:\s*(.+)/.exec(text)?.[1]?.trim() ??
    titleFromProperties(text) ??
    knownTitle ??
    "Untitled";

  // The path to it, outermost first (Notion lists the nearest first).
  const path: NotionItem[] = [];
  const ancestry =
    /<ancestor-path>([\s\S]*?)<\/ancestor-path>/.exec(text)?.[1] ?? "";
  for (const match of ancestry.matchAll(
    /<[a-z0-9-]*(page|database)[^>]*url="\{*([^"}]+)\}*"[^>]*title="([^"]*)"/g,
  )) {
    const ancestorId = notionId(match[2]);
    if (ancestorId) {
      path.unshift({
        id: ancestorId,
        title: decode(match[3]) || "Untitled",
        kind: match[1] === "database" ? "database" : "page",
      });
    }
  }

  const content =
    /<content>([\s\S]*?)<\/content>/.exec(text)?.[1] ??
    (isDatabase
      ? ""
      : text.replace(/<ancestor-path>[\s\S]*?<\/ancestor-path>/, ""));
  const children: NotionItem[] = [];
  for (const match of content.matchAll(
    /<(page|database)\s[^>]*url="\{*([^"}]+)\}*"[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    const childId = notionId(match[2]);
    if (childId && !children.some((c) => c.id === childId)) {
      children.push({
        id: childId,
        title: decode(match[3].trim()) || "Untitled",
        kind: match[1] === "database" ? "database" : "page",
      });
    }
  }

  let rows: NotionItem[] = [];
  if (isDatabase) {
    const dataSource =
      /data-source url="\{*(collection:\/\/[0-9a-f-]{36})\}*"/i.exec(text)?.[1];
    if (dataSource) {
      const found = await queryRows(dataSource).catch(() => []);
      rows = found.slice(0, 200).map((row) => ({
        id: row.pageId,
        title: rowText(row, "Name") || rowTitle(row.values),
        kind: "page" as const,
      }));
    }
  }

  return {
    id,
    title: decode(title),
    kind: isDatabase ? "database" : "page",
    path,
    markdown: toMarkdown(content),
    children,
    rows,
  };
}
