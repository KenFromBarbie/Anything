import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ExternalLink,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Maximize2,
  type LucideIcon,
  Music,
  Package,
  Pencil,
  Presentation,
  Search,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import {
  openDeskPanel,
  setBrowsing,
  useBrowsing,
} from "@/shared/lib/deskPanel";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Markdown } from "@/shared/ui/markdown";

import { ImageQuickEdit } from "./ImageQuickEdit";
import { AskForChanges, StudioMake } from "./StudioMake";
import { PageHeader } from "@/shared/ui/PageHeader";

/** Something an Office agent made and showed (`buzz-show`). */
export type Artifact = {
  id: string;
  title: string;
  note?: string;
  agent: string;
  agentId?: string;
  createdAt: number;
  kind:
    | "pdf"
    | "image"
    | "video"
    | "audio"
    | "html"
    | "text"
    | "office"
    | "file"
    | "site";
  /** Absolute paths (from the app), for the viewer. */
  path?: string;
  previewPath?: string;
  url?: string;
};

export const ARTIFACT_EVENT = "office-artifact";
export const ARTIFACTS_KEY = ["office", "artifacts"] as const;

const KIND_ICONS: Record<Artifact["kind"], LucideIcon> = {
  pdf: FileText,
  image: ImageIcon,
  video: Film,
  audio: Music,
  html: Globe,
  text: FileText,
  office: Presentation,
  file: Package,
  site: Globe,
};

const BrowserPage = React.lazy(async () => ({
  default: (await import("./BrowserPage")).BrowserPage,
}));

export function useArtifacts() {
  const client = useQueryClient();
  React.useEffect(() => {
    if (!isTauri()) return;
    const off = listen(ARTIFACT_EVENT, () => {
      void client.invalidateQueries({ queryKey: ARTIFACTS_KEY });
    });
    return () => void off.then((f) => f());
  }, [client]);
  return useQuery({
    queryKey: ARTIFACTS_KEY,
    queryFn: () => invoke<Artifact[]>("office_artifacts"),
    enabled: isTauri(),
  });
}

function when(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The gallery's filters, Claude-style. */
type Filter = "all" | "documents" | "slides" | "media" | "sites";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "documents", label: "Documents" },
  { key: "slides", label: "Slides" },
  { key: "media", label: "Media" },
  { key: "sites", label: "Sites" },
];

const SLIDES_RE = /\.(pptx?|odp|key)$/i;

function filterOf(item: Artifact): Exclude<Filter, "all"> {
  if (item.kind === "site" || item.kind === "html") return "sites";
  if (item.kind === "image" || item.kind === "video" || item.kind === "audio")
    return "media";
  if (SLIDES_RE.test(item.path ?? "")) return "slides";
  return "documents";
}

const COVERS = [
  "from-sky-500/60 to-indigo-600/60",
  "from-emerald-500/60 to-teal-700/60",
  "from-amber-400/60 to-rose-500/60",
  "from-fuchsia-500/60 to-purple-700/60",
];

function coverFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COVERS[Math.abs(hash) % COVERS.length] ?? COVERS[0];
}

/**
 * Artifacts: what the Office's agents made, as a gallery of cards with a
 * live look at each (laid out like Projects, filtered like Claude's), and
 * each one full size when opened. Files the app can't draw itself
 * (PowerPoint, Word) show their PDF preview when the agent made one, and
 * open in their own app.
 */
export function ArtifactsPage({
  embedded = false,
  initialId = null,
}: {
  /** Inside another page (Research): no header of its own. */
  embedded?: boolean;
  /** Open on this artifact (a chat link). */
  initialId?: string | null;
}) {
  const { data: items = [], isLoading } = useArtifacts();
  const [openId, setOpenId] = React.useState<string | null>(initialId);
  React.useEffect(() => {
    if (initialId) setOpenId(initialId);
  }, [initialId]);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [editing, setEditing] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const opened = items.find((item) => item.id === openId) ?? null;
  // A site (or a page an agent opened) shows in the live browser here.
  const browsing = useBrowsing() && embedded;

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (item) =>
      (filter === "all" || filterOf(item) === filter) &&
      (!q ||
        item.title.toLowerCase().includes(q) ||
        item.agent.toLowerCase().includes(q) ||
        (item.note ?? "").toLowerCase().includes(q)),
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4",
        !embedded && "px-4 py-6 sm:px-6",
      )}
      data-testid="artifacts-page"
    >
      {embedded ? null : (
        <PageHeader
          description="What the Office's agents made for you: decks, documents, videos, images and sites."
          title="Artifacts"
        />
      )}
      {browsing ? (
        <React.Suspense fallback={null}>
          <BrowserPage embedded onHome={() => setBrowsing(false)} />
        </React.Suspense>
      ) : opened ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              className="text-sm text-muted-foreground hover:text-foreground"
              data-testid="artifact-back"
              onClick={() => setOpenId(null)}
              type="button"
            >
              ← All artifacts
            </button>
            <span className="flex-1" />
            {opened.kind === "image" && opened.path ? (
              <Button
                data-testid="artifact-edit"
                onClick={() => setEditing(true)}
                size="sm"
                variant="outline"
              >
                <Pencil />
                Edit
              </Button>
            ) : null}
          </div>
          {opened.kind === "image" ? (
            <ImageQuickEdit
              item={opened}
              onOpenChange={setEditing}
              open={editing}
            />
          ) : null}
          <ArtifactViewer
            className="h-[calc(100vh-19rem)] min-h-[24rem]"
            item={opened}
          />
          {opened.kind === "site" ? null : <AskForChanges item={opened} />}
        </div>
      ) : (
        <>
          {embedded ? <StudioMake artifacts={items} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1" role="tablist">
              {FILTERS.map(({ key, label }) => (
                <button
                  aria-selected={filter === key}
                  className={cn(
                    "h-8 rounded-lg px-3 text-sm transition-colors",
                    filter === key
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  data-testid={`artifacts-filter-${key}`}
                  key={key}
                  onClick={() => setFilter(key)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-full max-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search artifacts"
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                value={query}
              />
            </div>
          </div>
          {isLoading ? null : items.length === 0 ? (
            <p className="rounded-2xl border border-border/70 bg-background/40 px-4 py-6 text-sm text-muted-foreground">
              Nothing yet. When an agent finishes a deck, document, video or
              site, it shows up here.
            </p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing matches.</p>
          ) : (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3"
              data-testid="artifacts-grid"
            >
              {shown.map((item) => (
                <ArtifactCard
                  item={item}
                  key={item.id}
                  onOpen={() => {
                    if (item.kind === "site" && item.url) {
                      // A site opens in the live browser, here.
                      setBrowsing(true);
                      void invoke("browser_navigate", { url: item.url }).catch(
                        () => {},
                      );
                    } else {
                      setOpenId(item.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A gallery card: a live look at the artifact, then what it is. */
function ArtifactCard({
  item,
  onOpen,
}: {
  item: Artifact;
  onOpen: () => void;
}) {
  const Icon = KIND_ICONS[item.kind] ?? Package;
  return (
    <button
      className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card/40 text-left transition-colors hover:border-border"
      data-testid={`artifact-${item.id}`}
      onClick={onOpen}
      type="button"
    >
      <div className="relative h-40 w-full overflow-hidden bg-muted/30">
        <ArtifactThumb item={item} />
        {/* Clicks go to the card, not into the preview. */}
        <span className="absolute inset-0" />
      </div>
      <div className="flex items-center gap-3 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/60">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {item.agent} · {when(item.createdAt)}
          </span>
        </span>
      </div>
    </button>
  );
}

/**
 * The card's look at the artifact: the picture, the video's first frame, the
 * page or PDF drawn small (at desktop width, scaled down), else a colour.
 */
function ArtifactThumb({ item }: { item: Artifact }) {
  const src = item.path ? convertFileSrc(item.path) : null;
  const preview = item.previewPath ? convertFileSrc(item.previewPath) : null;
  if (item.kind === "image" && src) {
    return (
      <img
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
        src={src}
      />
    );
  }
  if (item.kind === "video" && src) {
    return (
      <video
        className="h-full w-full object-cover"
        muted
        preload="metadata"
        src={`${src}#t=0.5`}
      />
    );
  }
  if (item.kind === "text" && src) {
    // The text itself, drawn small.
    return (
      <div className="pointer-events-none absolute left-0 top-0 w-[200%] origin-top-left scale-50 bg-background/80">
        <TextArtifact markdown={/\.md$/i.test(item.path ?? "")} src={src} />
      </div>
    );
  }
  const page =
    item.kind === "html" && src
      ? src
      : item.kind === "pdf" && src
        ? `${src}#toolbar=0&navpanes=0&view=FitH`
        : preview
          ? `${preview}#toolbar=0&navpanes=0&view=FitH`
          : null;
  if (page) {
    // Drawn at 1024×640 and scaled to the card, like a screenshot.
    return (
      <iframe
        className="pointer-events-none absolute left-0 top-0 h-[640px] w-[1024px] origin-top-left scale-[0.27] border-0 bg-white"
        loading="lazy"
        sandbox={item.kind === "html" ? "allow-scripts" : undefined}
        src={page}
        tabIndex={-1}
        title={`Preview of ${item.title}`}
      />
    );
  }
  const Icon = KIND_ICONS[item.kind] ?? Package;
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 bg-linear-to-br text-white/90",
        coverFor(item.id),
      )}
    >
      <Icon className="h-8 w-8" />
      {item.kind === "site" && item.url ? (
        <span className="max-w-[80%] truncate text-xs text-white/80">
          {item.url}
        </span>
      ) : null}
    </div>
  );
}

/** A page shown in chat at the height it says it needs: artifacts built for
 *  the app post `{ anythingHeight }` to their parent (see the agents' guide,
 *  BUZZ.md); one that doesn't gets a fixed frame and scrolls. */
const PAGE_HEIGHT = { initial: 576, min: 160, max: 1600 };

function SizedPage({ src, title }: { src: string; title: string }) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(PAGE_HEIGHT.initial);
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const wanted = Number(
        (event.data as { anythingHeight?: unknown } | null)?.anythingHeight,
      );
      if (!Number.isFinite(wanted) || wanted <= 0) return;
      setHeight(
        Math.min(PAGE_HEIGHT.max, Math.max(PAGE_HEIGHT.min, Math.ceil(wanted))),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <iframe
      className="block w-full border-0"
      ref={frame}
      sandbox="allow-scripts"
      src={src}
      style={{ height }}
      title={title}
    />
  );
}

/** A text artifact: Markdown rendered, anything else as it is. */
function TextArtifact({ src, markdown }: { src: string; markdown: boolean }) {
  const text = useQuery({
    queryKey: ["office", "artifact-text", src],
    queryFn: async () => {
      const response = await fetch(src);
      if (!response.ok)
        throw new Error(`couldn't read it (${response.status})`);
      return response.text();
    },
  });
  if (text.error) {
    return <p className="p-6 text-sm text-destructive">{String(text.error)}</p>;
  }
  if (text.data === undefined) return null;
  return markdown ? (
    <div className="px-6 py-5 text-sm">
      <Markdown className="leading-6" content={text.data} />
    </div>
  ) : (
    <pre className="whitespace-pre-wrap px-6 py-5 font-mono text-xs">
      {text.data}
    </pre>
  );
}

/** One artifact by id, for a channel's side panel. */
export function ArtifactPanel({
  id,
  onExpand,
  bare = false,
}: {
  id: string;
  /** Shown in a chat message: a button that opens it larger. */
  onExpand?: () => void;
  /** In a chat message: the artifact itself, no card around it. */
  bare?: boolean;
}) {
  const { data: items, isLoading } = useArtifacts();
  const item = items?.find((candidate) => candidate.id === id);
  if (isLoading) return null;
  if (!item) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        That artifact isn't in this server's Office.
      </p>
    );
  }
  return <ArtifactViewer bare={bare} compact item={item} onExpand={onExpand} />;
}

export function ArtifactViewer({
  item,
  compact = false,
  onExpand,
  bare = false,
  className,
}: {
  item: Artifact;
  className?: string;
  /** The artifact itself at full width (in chat), its buttons over a corner. */
  bare?: boolean;
  /** In a side panel: no border or header of its own beyond the title row. */
  compact?: boolean;
  onExpand?: () => void;
}) {
  const open = () =>
    void invoke("office_artifact_open", { id: item.id }).catch(() => {});
  // In a channel the Browser opens beside the chat; elsewhere, its tab.
  const showSite = (url: string) =>
    void invoke("browser_navigate", { url }).then(() =>
      openDeskPanel({ kind: "browser" }),
    );
  const src = item.path ? convertFileSrc(item.path) : null;
  const preview = item.previewPath ? convertFileSrc(item.previewPath) : null;

  let body: React.ReactNode;
  if (item.kind === "site" && item.url) {
    body = (
      <div className="flex flex-col items-start gap-3 p-6 text-sm">
        <p className="break-all text-muted-foreground">{item.url}</p>
        <Button onClick={() => showSite(item.url as string)}>
          <Globe className="h-4 w-4" />
          Open in the Browser
        </Button>
      </div>
    );
  } else if (item.kind === "image" && src) {
    body = (
      <img
        alt={item.title}
        className="mx-auto max-h-full max-w-full object-contain"
        src={src}
      />
    );
  } else if (item.kind === "video" && src) {
    // biome-ignore lint/a11y/useMediaCaption: agent-made video, no captions
    body = <video className="h-full w-full" controls src={src} />;
  } else if (item.kind === "audio" && src) {
    // biome-ignore lint/a11y/useMediaCaption: agent-made audio, no captions
    body = <audio className="m-6 w-[calc(100%-3rem)]" controls src={src} />;
  } else if (item.kind === "text" && src) {
    body = <TextArtifact markdown={/\.md$/i.test(item.path ?? "")} src={src} />;
  } else if ((item.kind === "pdf" || item.kind === "html") && src) {
    body = (
      <iframe
        className="h-full w-full bg-white"
        sandbox={item.kind === "html" ? "allow-scripts" : undefined}
        src={src}
        title={item.title}
      />
    );
  } else if (preview) {
    body = (
      <iframe
        className="h-full w-full bg-white"
        src={preview}
        title={item.title}
      />
    );
  } else {
    body = (
      <p className="p-6 text-sm text-muted-foreground">
        The app can't show this kind of file here. Open it in its own app.
      </p>
    );
  }

  if (bare) {
    // Pages, PDFs and previews get room to be used in place; pictures, video
    // and text take their own size.
    const framed =
      (item.kind === "pdf" || item.kind === "html" || !!preview) &&
      item.kind !== "image" &&
      item.kind !== "video" &&
      item.kind !== "text";
    const page = item.kind === "html" && src;
    return (
      <div
        className={cn(
          "group relative overflow-hidden rounded-xl border border-border/60 bg-background/40",
          framed && !page && "h-[36rem]",
          item.kind === "image" && "[&_img]:max-h-[40rem]",
        )}
        data-testid="artifact-viewer"
        title={`${item.title} · ${item.agent}`}
      >
        {page ? <SizedPage src={src} title={item.title} /> : body}
        <div className="absolute right-2 top-2 flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          {item.path ? (
            <Button
              aria-label="Open in its own app"
              className="h-7 bg-background/90 px-2 shadow-sm"
              onClick={open}
              size="sm"
              variant="outline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </Button>
          ) : null}
          {onExpand ? (
            <Button
              aria-label="Open larger beside the chat"
              className="h-7 w-7 bg-background/90 shadow-sm"
              data-testid="artifact-expand"
              onClick={onExpand}
              size="icon"
              variant="outline"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        compact
          ? "h-full"
          : "rounded-2xl border border-border/70 bg-background/40",
        className,
      )}
      data-testid="artifact-viewer"
    >
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="truncate text-sm font-semibold">{item.title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {item.agent} · {when(item.createdAt)}
            {item.note ? ` · ${item.note}` : ""}
          </p>
        </div>
        {item.path ? (
          <Button onClick={open} size="sm" variant="outline">
            <ExternalLink className="h-4 w-4" />
            Open
          </Button>
        ) : null}
        {onExpand ? (
          <Button
            aria-label="Open larger beside the chat"
            data-testid="artifact-expand"
            onClick={onExpand}
            size="icon"
            variant="ghost"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        ) : null}
      </header>
      <div
        className={cn(
          "flex-1 overflow-auto",
          compact ? "min-h-0" : "min-h-[24rem]",
        )}
      >
        {body}
      </div>
    </section>
  );
}
