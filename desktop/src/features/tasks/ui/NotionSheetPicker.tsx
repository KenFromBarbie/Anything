import * as React from "react";
import { Database, FileText, Loader2, Search } from "lucide-react";

import {
  guessMyMap,
  inspectDatabase,
  type MyMap,
  searchPages,
} from "@/features/tasks/lib/notion";
import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";

type Found = { id: string; title: string };

/** A searchable list of the owner's Notion pages or databases. */
export function NotionSearchList({
  kind,
  onPick,
  picked,
}: {
  kind: "page" | "database";
  onPick: (item: Found) => void;
  picked: string | null;
}) {
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<Found[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      searchPages(query, kind)
        .then((found) => {
          if (!cancelled) setItems(found);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, kind]);

  const Icon = kind === "page" ? FileText : Database;
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            kind === "page"
              ? "Search your Notion pages"
              : "Search your Notion databases"
          }
          value={query}
        />
      </div>
      <div
        className="max-h-56 min-h-24 overflow-y-auto rounded-2xl border border-border/70"
        data-testid={`notion-${kind}-list`}
      >
        {loading ? (
          <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Looking…
          </div>
        ) : error ? (
          <p className="p-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nothing matches. Try another word.
          </p>
        ) : (
          items.map((item) => (
            <button
              className={cn(
                "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60",
                picked === item.id && "bg-muted font-medium",
              )}
              key={item.id}
              onClick={() => onPick(item)}
              type="button"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{item.title}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export type PickedSheet = { dataSource: string; map: MyMap; title: string };

/**
 * Choosing a database the owner already has as their task sheet: reads its
 * columns and shows how Buzz will use them.
 */
export function ExistingSheetPicker({
  onChange,
}: {
  onChange: (sheet: PickedSheet | null) => void;
}) {
  const [picked, setPicked] = React.useState<Found | null>(null);
  const [sheet, setSheet] = React.useState<PickedSheet | null>(null);
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pick = async (item: Found) => {
    setPicked(item);
    setSheet(null);
    onChange(null);
    setError(null);
    setReading(true);
    try {
      const { dataSource, columns } = await inspectDatabase(item.id);
      const map = guessMyMap(columns);
      if (!map) throw new Error("That database has no title column.");
      const next = { dataSource, map, title: item.title };
      setSheet(next);
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="grid gap-2">
      <NotionSearchList
        kind="database"
        onPick={(item) => void pick(item)}
        picked={picked?.id ?? null}
      />
      {reading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading its columns…
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {sheet ? <MapSummary map={sheet.map} /> : null}
    </div>
  );
}

function MapSummary({ map }: { map: MyMap }) {
  const rows: [string, string][] = [
    ["Task", map.name],
    ["Status", map.status ?? "none (all tasks show as To do)"],
    ["Due date", map.due ?? "none"],
    ["Notes", map.notes ?? "none"],
  ];
  return (
    <div className="grid gap-1 rounded-2xl bg-muted/50 px-4 py-3 text-xs">
      <p className="font-medium text-foreground">Kenn’s Harness will use</p>
      {rows.map(([label, value]) => (
        <p className="text-muted-foreground" key={label}>
          <span className="inline-block w-20">{label}</span>
          <span className="text-foreground">{value}</span>
        </p>
      ))}
      {map.status ? (
        <p className="text-muted-foreground">
          <span className="inline-block w-20">Statuses</span>
          <span className="text-foreground">
            {map.statuses.todo} · {map.statuses.doing} · {map.statuses.done}
          </span>
        </p>
      ) : null}
      {!map.statuses.archived ? (
        <p className="pt-1 text-muted-foreground">
          It has no "Archived" status, so tasks are removed in Notion itself.
        </p>
      ) : null}
    </div>
  );
}
