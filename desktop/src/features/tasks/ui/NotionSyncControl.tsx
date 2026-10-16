import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { notionDisconnect } from "@/features/tasks/lib/notion";
import { syncOfficeTasks } from "@/features/tasks/lib/notionSync";
import {
  NOTION_STATUS_KEY,
  notionUrl,
  useNotionStatus,
  useSyncStatus,
} from "@/features/tasks/lib/useTasksData";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { NotionConnectDialog, NotionSheetDialog } from "./NotionConnectDialog";

function ago(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** The Tasks page's Notion state: connect, sync now, open, disconnect. */
export function NotionSyncControl() {
  const client = useQueryClient();
  const { data: status } = useNotionStatus();
  const sync = useSyncStatus();
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const officeDb = status?.config.officeDb;
  const ready = !!status?.connected && !!officeDb && !!status.config.myDb;

  if (!ready) {
    return (
      <>
        <Button
          data-testid="notion-connect"
          onClick={() => setConnectOpen(true)}
          size="sm"
          variant="outline"
        >
          <NotionMark />
          {status?.connected ? "Finish Notion setup" : "Connect Notion"}
        </Button>
        <NotionConnectDialog onOpenChange={setConnectOpen} open={connectOpen} />
      </>
    );
  }

  const label = sync.running
    ? "Syncing…"
    : sync.error
      ? "Sync failed"
      : sync.last
        ? `Synced ${ago(sync.last.at)}`
        : status.workspace
          ? `Notion · ${status.workspace}`
          : "Notion connected";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="notion-sync-status" size="sm" variant="outline">
            {sync.running ? (
              <Loader2 className="animate-spin" />
            ) : sync.error ? (
              <AlertTriangle className="text-destructive" />
            ) : (
              <Check className="text-emerald-500" />
            )}
            {label}
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {sync.error ? (
            <p className="px-2 py-1.5 text-xs text-destructive">{sync.error}</p>
          ) : null}
          <DropdownMenuItem
            disabled={sync.running}
            onSelect={() =>
              void syncOfficeTasks(officeDb).catch((e: unknown) =>
                toast.error(e instanceof Error ? e.message : String(e)),
              )
            }
          >
            <RefreshCw />
            Sync now
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openUrl(notionUrl(officeDb))}>
            <ExternalLink />
            Open the agents' board in Notion
          </DropdownMenuItem>
          {status.config.myDb ? (
            <DropdownMenuItem
              onSelect={() => void openUrl(notionUrl(status.config.myDb ?? ""))}
            >
              <ExternalLink />
              Open my tasks in Notion
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setSheetOpen(true)}>
            <ListChecks />
            Use another task sheet…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmDisconnect(true)}>
            <Unplug />
            Sign out of Notion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NotionSheetDialog onOpenChange={setSheetOpen} open={sheetOpen} />
      <AlertDialog onOpenChange={setConfirmDisconnect} open={confirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of Notion?</AlertDialogTitle>
            <AlertDialogDescription>
              Kenn’s Harness forgets your Notion sign-in and stops syncing. Your
              databases stay in Notion; signing in again sets up new ones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void notionDisconnect()
                  .then(() =>
                    client.invalidateQueries({ queryKey: NOTION_STATUS_KEY }),
                  )
                  .catch((e: unknown) =>
                    toast.error(e instanceof Error ? e.message : String(e)),
                  )
              }
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Notion's "N", drawn plainly. */
export function NotionMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 16 16"
    >
      <rect
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        width="13"
        x="1.5"
        y="1.5"
      />
      <path
        d="M5.5 11V5l5 6V5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}
