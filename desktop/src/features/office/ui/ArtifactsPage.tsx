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
  Presentation,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { openDeskPanel } from "@/shared/lib/deskPanel";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
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

/**
 * Artifacts: the decks, documents, videos, images and sites the Office's
 * agents made, newest first, with a viewer. Files the app can't draw itself
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
  const [selectedId, setSelectedId] = React.useState<string | null>(initialId);
  React.useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);
  const selected =
    items.find((item) => item.id === selectedId) ?? items[0] ?? null;

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
      {isLoading ? null : items.length === 0 ? (
        <p className="rounded-2xl border border-border/70 bg-background/40 px-4 py-6 text-sm text-muted-foreground">
          Nothing yet. When an agent finishes a deck, document, video or site,
          it shows up here.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
          <ul
            className="flex min-h-0 flex-col gap-1 overflow-y-auto"
            data-testid="artifacts-list"
          >
            {items.map((item) => {
              const Icon = KIND_ICONS[item.kind] ?? Package;
              const active = item.id === selected?.id;
              return (
                <li key={item.id}>
                  <button
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors",
                      active
                        ? "bg-muted"
                        : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
                    )}
                    data-testid={`artifact-${item.id}`}
                    onClick={() => setSelectedId(item.id)}
                    type="button"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {item.agent} · {when(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected ? <ArtifactViewer item={selected} /> : null}
        </div>
      )}
    </div>
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
}: {
  id: string;
  /** Shown in a chat message: a button that opens it larger. */
  onExpand?: () => void;
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
  return <ArtifactViewer compact item={item} onExpand={onExpand} />;
}

export function ArtifactViewer({
  item,
  compact = false,
  onExpand,
}: {
  item: Artifact;
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

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        compact
          ? "h-full"
          : "rounded-2xl border border-border/70 bg-background/40",
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
