import * as React from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  type CommunityFile,
  type FileKind,
  fileKind,
  useCommunityFiles,
} from "@/features/files/lib/useCommunityFiles";
import { FileKindIcon } from "@/features/sidebar/ui/SidebarThreadsAndFiles";
import { cn } from "@/shared/lib/cn";
import { PageHeader } from "@/shared/ui/PageHeader";

const FILTERS: { value: FileKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
];

function size(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/**
 * Files: everything shared in this community's channels, newest first, by
 * kind and channel. Each opens the message it was shared in.
 */
export function FilesPage() {
  const { data: files = [], isLoading } = useCommunityFiles();
  const [kind, setKind] = React.useState<FileKind | "all">("all");
  const [channel, setChannel] = React.useState<string>("all");
  const channels = React.useMemo(
    () =>
      [
        ...new Map(files.map((f) => [f.channelId, f.channelName])).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [files],
  );
  const shown = files.filter(
    (file) =>
      (kind === "all" || fileKind(file) === kind) &&
      (channel === "all" || file.channelId === channel),
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6"
      data-testid="files-page"
    >
      <PageHeader
        description="Everything shared in this server's channels."
        title="Files"
      />
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <button
            className={cn(
              "rounded-full px-3 py-1 text-sm transition-colors",
              kind === filter.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 hover:bg-muted",
            )}
            key={filter.value}
            onClick={() => setKind(filter.value)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
        {channels.length > 1 ? (
          <select
            aria-label="Channel"
            className="ml-auto h-8 rounded-lg border border-border/70 bg-background/80 px-2 text-sm"
            onChange={(event) => setChannel(event.target.value)}
            value={channel}
          >
            <option value="all">All channels</option>
            {channels.map(([id, name]) => (
              <option key={id} value={id}>
                #{name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Looking through the channels…
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
          {files.length === 0
            ? "No files have been shared in this server's channels yet."
            : "No files match."}
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {shown.map((file) => (
            <FileCard file={file} key={file.key} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FileCard({ file }: { file: CommunityFile }) {
  const { goChannel } = useAppNavigation();
  const [broken, setBroken] = React.useState(false);
  const preview = fileKind(file) === "image" ? file.url : (file.thumb ?? null);
  return (
    <li className="overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-xs">
      <button
        className="block w-full text-left"
        onClick={() =>
          void goChannel(file.channelId, { messageId: file.eventId })
        }
        title={`Open the message in #${file.channelName}`}
        type="button"
      >
        <div className="flex aspect-[4/3] items-center justify-center bg-muted/40">
          {preview && !broken ? (
            <img
              alt={file.name}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setBroken(true)}
              src={preview}
            />
          ) : (
            <FileKindIcon
              className="h-8 w-8 text-muted-foreground"
              file={file}
            />
          )}
        </div>
        <div className="grid gap-0.5 p-2.5">
          <span className="truncate text-sm font-medium">{file.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            #{file.channelName} · {when(file.createdAt)}
            {file.size ? ` · ${size(file.size)}` : ""}
          </span>
        </div>
      </button>
      <a
        className="flex items-center gap-1 border-t border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        href={file.url}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="h-3 w-3" />
        Open file
      </a>
    </li>
  );
}
