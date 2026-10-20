import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  Search,
} from "lucide-react";

import {
  listNotion,
  type NotionItem,
  openNotion,
} from "@/features/notion/lib/notionBrowse";
import { notionUrl } from "@/features/tasks/lib/notion";
import { useNotionStatus } from "@/features/tasks/lib/useTasksData";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Markdown } from "@/shared/ui/markdown";
import { PageHeader } from "@/shared/ui/PageHeader";

function KindIcon({
  item,
  className,
}: {
  item: Pick<NotionItem, "kind">;
  className?: string;
}) {
  return item.kind === "database" ? (
    <Database className={className} />
  ) : (
    <FileText className={className} />
  );
}

/**
 * Notion, read in the app: search your workspace (recent pages when the box
 * is empty) and open any page or database — its content, the pages inside
 * it, a database's rows, and the path back up. Each opens in Notion too.
 */
export function NotionPage() {
  const { data: status } = useNotionStatus();
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState<NotionItem | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const connected = !!status?.connected;
  const list = useQuery({
    queryKey: ["notion-browse", "list", debounced],
    queryFn: () => listNotion(debounced),
    enabled: connected,
    staleTime: 60_000,
  });
  const doc = useQuery({
    queryKey: ["notion-browse", "doc", open?.id],
    queryFn: () => openNotion(open?.id ?? "", open?.title),
    enabled: connected && !!open,
    staleTime: 60_000,
  });

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-6 sm:px-6"
      data-testid="notion-page"
    >
      <PageHeader
        description={
          status?.workspace
            ? `Your Notion workspace, ${status.workspace}.`
            : "Your Notion pages and databases."
        }
        title="Notion"
      />
      {!connected ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
          Notion isn't connected. Connect it from the Tasks page (Notion), then
          your pages show here.
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col gap-2 rounded-2xl border border-border/70 bg-card/70 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-8"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Notion"
                value={query}
              />
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              {debounced.trim() ? "Results" : "Recent"}
            </p>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.isLoading ? (
                <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Looking…
                </li>
              ) : null}
              {list.error ? (
                <li className="px-2 py-3 text-sm text-destructive">
                  {list.error instanceof Error
                    ? list.error.message
                    : String(list.error)}
                </li>
              ) : null}
              {(list.data ?? []).map((item) => (
                <li key={item.id}>
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                      open?.id === item.id && "bg-muted",
                    )}
                    onClick={() => setOpen(item)}
                    type="button"
                  >
                    <KindIcon
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      item={item}
                    />
                    <span className="truncate">{item.title}</span>
                  </button>
                </li>
              ))}
              {!list.isLoading &&
              (list.data ?? []).length === 0 &&
              !list.error ? (
                <li className="px-2 py-3 text-sm text-muted-foreground">
                  Nothing found.
                </li>
              ) : null}
            </ul>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/70">
            {!open ? (
              <div className="m-auto p-8 text-center text-sm text-muted-foreground">
                Pick a page or database to read it here.
              </div>
            ) : doc.isLoading ? (
              <div className="m-auto flex items-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening {open.title}…
              </div>
            ) : doc.error ? (
              <div className="m-auto p-8 text-sm text-destructive">
                {doc.error instanceof Error
                  ? doc.error.message
                  : String(doc.error)}
              </div>
            ) : doc.data ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {doc.data.path.length > 0 ? (
                  <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {doc.data.path.map((step) => (
                      <React.Fragment key={step.id}>
                        <button
                          className="max-w-48 truncate hover:text-foreground hover:underline"
                          onClick={() => setOpen(step)}
                          type="button"
                        >
                          {step.title}
                        </button>
                        <ChevronRight className="h-3 w-3" />
                      </React.Fragment>
                    ))}
                  </nav>
                ) : null}
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h2 className="flex min-w-0 items-center gap-2 text-xl font-semibold">
                    <KindIcon
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                      item={doc.data}
                    />
                    <span className="truncate">{doc.data.title}</span>
                  </h2>
                  <Button
                    onClick={() => void openUrl(notionUrl(doc.data.id))}
                    size="sm"
                    variant="outline"
                  >
                    <ExternalLink />
                    Open in Notion
                  </Button>
                </div>
                {doc.data.markdown ? (
                  <div className="text-sm leading-6">
                    <Markdown content={doc.data.markdown} />
                  </div>
                ) : null}
                {doc.data.children.length > 0 ? (
                  <ItemList
                    items={doc.data.children}
                    onOpen={setOpen}
                    title="Inside this page"
                  />
                ) : null}
                {doc.data.kind === "database" ? (
                  <ItemList
                    empty="No rows."
                    items={doc.data.rows}
                    onOpen={setOpen}
                    title={`Rows (${doc.data.rows.length})`}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}

function ItemList({
  empty,
  items,
  onOpen,
  title,
}: {
  empty?: string;
  items: NotionItem[];
  onOpen: (item: NotionItem) => void;
  title: string;
}) {
  return (
    <div className="mt-5 grid gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {items.length === 0 && empty ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : null}
      <ul className="grid gap-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/60"
              onClick={() => onOpen(item)}
              type="button"
            >
              <KindIcon
                className="h-4 w-4 shrink-0 text-muted-foreground"
                item={item}
              />
              <span className="truncate">{item.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
