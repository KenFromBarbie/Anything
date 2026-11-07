import * as React from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import {
  type CommunityFile,
  useCommunityFiles,
} from "@/features/files/lib/useCommunityFiles";
import { FileKindIcon } from "@/features/sidebar/ui/SidebarThreadsAndFiles";
import { invokeTauri } from "@/shared/api/tauri";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

/** Opens the export dialog from anywhere (the Office's printer). */
const OPEN_EVENT = "anything:export-files";
export const openExportFiles = () =>
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));

type ExportReport = { folder: string; saved: number; failed: string[] };

/**
 * Export shared files: everything under All files, with a tick-box each (all
 * ticked to begin with). Export asks for a folder once and saves the ticked
 * files into it.
 */
export function ExportFilesDialog() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const { data: files = [], isLoading } = useCommunityFiles();

  React.useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  // Everything ticked each time it opens.
  React.useEffect(() => {
    if (open) {
      setPicked(new Set(files.map((f) => f.key)));
      setQuery("");
    }
  }, [open, files]);

  const shown = files.filter((f) =>
    `${f.name} ${f.channelName}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const chosen = files.filter((f) => picked.has(f.key));
  const allShownPicked = shown.length > 0 && shown.every((f) => picked.has(f.key));

  const toggle = (file: CommunityFile, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(file.key);
      else next.delete(file.key);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      const report = await invokeTauri<ExportReport | null>("export_files", {
        files: chosen.map((f) => ({ url: f.url, filename: f.name })),
      });
      if (!report) return; // folder dialog cancelled
      if (report.failed.length) {
        toast.warning(
          `Exported ${report.saved} of ${chosen.length} to ${report.folder}. Not exported: ${report.failed.join("; ")}`,
        );
      } else {
        toast.success(`Exported ${report.saved} files to ${report.folder}`);
      }
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(next) => !busy && setOpen(next)} open={open}>
      <DialogContent className="max-w-lg" data-testid="export-files-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Export files
          </DialogTitle>
          <DialogDescription>
            The files shared in this server&apos;s channels. Tick the ones to
            export, then pick a folder to save them in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files or channels"
            value={query}
          />
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <Checkbox
              checked={allShownPicked}
              data-testid="export-files-all"
              disabled={shown.length === 0}
              onCheckedChange={(value) =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  for (const f of shown) {
                    if (value === true) next.add(f.key);
                    else next.delete(f.key);
                  }
                  return next;
                })
              }
            />
            All
          </label>
        </div>
        <ul className="grid max-h-80 gap-0.5 overflow-y-auto">
          {isLoading ? (
            <li className="px-2 py-4 text-sm text-muted-foreground">Looking for files…</li>
          ) : shown.length === 0 ? (
            <li className="px-2 py-4 text-sm text-muted-foreground">
              {files.length === 0 ? "No files shared yet." : "No files match."}
            </li>
          ) : (
            shown.map((file) => (
              <li key={file.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
                  <Checkbox
                    checked={picked.has(file.key)}
                    data-testid="export-files-item"
                    onCheckedChange={(value) => toggle(file, value === true)}
                  />
                  <FileKindIcon className="h-4 w-4 shrink-0" file={file} />
                  <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">#{file.channelName}</span>
                </label>
              </li>
            ))
          )}
        </ul>
        <DialogFooter>
          <Button disabled={busy} onClick={() => setOpen(false)} variant="outline">
            Cancel
          </Button>
          <Button
            data-testid="export-files-run"
            disabled={busy || chosen.length === 0}
            onClick={() => void run()}
          >
            {busy ? "Exporting…" : `Export ${chosen.length} ${chosen.length === 1 ? "file" : "files"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
