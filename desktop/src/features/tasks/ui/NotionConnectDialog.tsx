import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import {
  createTaskDatabases,
  notionCancelSignIn,
  notionSignIn,
  adoptMyDb,
} from "@/features/tasks/lib/notion";
import {
  NOTION_STATUS_KEY,
  useNotionStatus,
} from "@/features/tasks/lib/useTasksData";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import {
  ExistingSheetPicker,
  NotionSearchList,
  type PickedSheet,
} from "./NotionSheetPicker";

/**
 * Connecting Notion: the owner signs in with their Notion account (in the
 * browser; Buzz keeps the sign-in in the OS keychain), then picks the page
 * that will hold the two task databases. Opens at the step still missing.
 */
export function NotionConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: status } = useNotionStatus();
  const step = status?.connected ? "page" : "sign-in";
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg" data-testid="notion-connect-dialog">
        {step === "sign-in" ? (
          <SignInStep />
        ) : (
          <PageStep onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SignInStep() {
  const client = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await notionSignIn();
      await client.invalidateQueries({ queryKey: NOTION_STATUS_KEY });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Connect Notion</DialogTitle>
        <DialogDescription>
          Sign in with your Notion account. Your own task sheet lives there, and
          the agents' board syncs with it both ways.
        </DialogDescription>
      </DialogHeader>
      <ol className="grid list-decimal gap-2 pl-5 text-sm text-muted-foreground">
        <li>Notion opens in your browser.</li>
        <li>Pick the workspace and approve Kenn’s Harness.</li>
        <li>Come back here to choose where the task databases go.</li>
      </ol>
      {busy ? (
        <p className="flex items-center gap-2 rounded-2xl bg-muted/50 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for you to approve in the browser…
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        {busy ? (
          <Button
            onClick={() => void notionCancelSignIn()}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        ) : null}
        <Button
          data-testid="notion-sign-in"
          disabled={busy}
          onClick={signIn}
          type="button"
        >
          <NotionGlyph />
          Sign in with Notion
        </Button>
      </DialogFooter>
    </div>
  );
}

function NotionGlyph() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
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

function PageStep({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const [picked, setPicked] = React.useState<string | null>(null);
  const [mine, setMine] = React.useState<"new" | "existing">("new");
  const [sheet, setSheet] = React.useState<PickedSheet | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = !!picked && (mine === "new" || !!sheet);

  const create = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await createTaskDatabases(picked, mine === "existing" ? sheet : null);
      await client.invalidateQueries({ queryKey: NOTION_STATUS_KEY });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Where should the tasks live?</DialogTitle>
        <DialogDescription>
          Pick a page for the agents' board (“Office tasks”). Your own sheet can
          be a new “My tasks” there, or a task database you already have.
        </DialogDescription>
      </DialogHeader>
      <NotionSearchList
        kind="page"
        onPick={(page) => setPicked(page.id)}
        picked={picked}
      />
      <SegmentedChoice
        onChange={setMine}
        options={[
          ["new", "New “My tasks”"],
          ["existing", "Use one I have"],
        ]}
        value={mine}
      />
      {mine === "existing" ? <ExistingSheetPicker onChange={setSheet} /> : null}
      {error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          data-testid="notion-create"
          disabled={!ready || busy}
          onClick={create}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {mine === "new"
            ? "Create task databases"
            : "Create the board and use my sheet"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Switching the owner's sheet to another database (the board stays). */
export function NotionSheetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [sheet, setSheet] = React.useState<PickedSheet | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    try {
      await adoptMyDb(sheet.dataSource, sheet.map);
      await client.invalidateQueries({ queryKey: NOTION_STATUS_KEY });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg">
        <div className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Use another task sheet</DialogTitle>
            <DialogDescription>
              Pick one of your Notion task databases to show under My tasks.
              Nothing in Notion changes.
            </DialogDescription>
          </DialogHeader>
          {open ? <ExistingSheetPicker onChange={setSheet} /> : null}
          {error ? (
            <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={!sheet || busy} onClick={save}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Use this sheet
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SegmentedChoice<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: [T, string][];
  value: T;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1 text-sm">
      {options.map(([key, label]) => (
        <button
          aria-pressed={value === key}
          className={cn(
            "rounded-lg px-3 py-1.5 transition-colors",
            value === key
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          key={key}
          onClick={() => onChange(key)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
