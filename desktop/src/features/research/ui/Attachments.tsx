import * as React from "react";
import { File as FileIcon, Paperclip, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const MAX_BYTES = 200 * 1024 * 1024;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isFileDrag(event: React.DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Attaching files the way the chat composer does: a paperclip, dropping files
 * on the area, or pasting them. Files over 200 MB are turned away.
 */
export function useAttachments(onRejected?: (names: string[]) => void) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const add = React.useCallback(
    (incoming: Iterable<File>) => {
      const list = [...incoming];
      const tooBig = list.filter((f) => f.size > MAX_BYTES).map((f) => f.name);
      if (tooBig.length > 0) onRejected?.(tooBig);
      const ok = list.filter((f) => f.size <= MAX_BYTES);
      if (ok.length === 0) return;
      setFiles((current) => [
        ...current,
        ...ok.filter(
          (f) => !current.some((c) => c.name === f.name && c.size === f.size),
        ),
      ]);
    },
    [onRejected],
  );

  const dropProps = {
    onDragEnter: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      setDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setDragging(false);
      add(event.dataTransfer.files);
    },
    onPaste: (event: React.ClipboardEvent) => {
      if (event.clipboardData.files.length === 0) return;
      event.preventDefault();
      add(event.clipboardData.files);
    },
  };

  const input = (
    <input
      className="hidden"
      multiple
      onChange={(event) => {
        if (event.target.files) add(event.target.files);
        event.target.value = "";
      }}
      ref={inputRef}
      type="file"
    />
  );

  return {
    files,
    dragging,
    dropProps,
    input,
    open: () => inputRef.current?.click(),
    remove: (file: File) =>
      setFiles((current) => current.filter((f) => f !== file)),
    clear: () => setFiles([]),
  };
}

export function AttachButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label="Attach files"
      data-testid="research-attach"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title="Attach files"
      type="button"
      variant="ghost"
    >
      <Paperclip />
      Attach
    </Button>
  );
}

export function AttachmentChips({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (file: File) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" data-testid="research-attachments">
      {files.map((file) => (
        <li
          className="flex max-w-64 items-center gap-2 rounded-lg border border-border/70 bg-background px-2 py-1 text-xs"
          key={`${file.name}-${file.size}-${file.lastModified}`}
        >
          <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{file.name}</span>
          <span className="shrink-0 text-muted-foreground">
            {size(file.size)}
          </span>
          <button
            aria-label={`Remove ${file.name}`}
            className="shrink-0 rounded text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(file)}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The "drop files here" outline shown while dragging over an area. */
export function dropOutline(dragging: boolean) {
  return cn(
    dragging && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background",
  );
}
