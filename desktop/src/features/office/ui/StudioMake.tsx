import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  BarChart3,
  BookOpen,
  Box,
  CalendarDays,
  Camera,
  ChartLine,
  CodeXml,
  Ellipsis,
  FileText,
  Film,
  FolderGit2,
  Globe,
  Image as ImageIcon,
  Loader2,
  type LucideIcon,
  Mail,
  Megaphone,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Send,
  Shapes,
  Shirt,
  Sparkles,
  Trash2,
  WandSparkles,
  Wind,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import {
  appRequest,
  changeRequest,
  MAKE_KINDS,
  type MakeKind,
  makeRequest,
  type StudioWorkflow,
  workflowRequest,
} from "@/features/office/lib/studioRequests";
import {
  deleteWorkflow,
  saveWorkflow,
  useCodebases,
  useStudioWorkflows,
  WORKFLOWS_KEY,
} from "@/features/office/lib/studioStore";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

import { openEditor } from "@/features/office/editors/editorStore";
import { blankFile, type EditorKind } from "@/features/office/editors/formats";

import type { Artifact } from "./ArtifactsPage";

/** The tiles that open one of the app's own editors. */
const EDITOR_FOR: Partial<Record<MakeKind, EditorKind>> = {
  document: "doc",
  slides: "slides",
  chart: "sheet",
  image: "image",
};
import { AddCodebaseDialog } from "./Codebases";

const TILES: Record<MakeKind, { icon: LucideIcon; tone: string }> = {
  document: { icon: FileText, tone: "bg-sky-600/80 text-sky-50" },
  slides: { icon: Presentation, tone: "bg-orange-700/80 text-orange-50" },
  chart: { icon: BarChart3, tone: "bg-rose-700/80 text-rose-50" },
  image: { icon: ImageIcon, tone: "bg-emerald-700/80 text-emerald-50" },
  video: { icon: Film, tone: "bg-violet-700/80 text-violet-50" },
  model: { icon: Box, tone: "bg-amber-600/80 text-amber-50" },
  clothing: { icon: Shirt, tone: "bg-pink-700/80 text-pink-50" },
  simulation: { icon: Wind, tone: "bg-cyan-700/80 text-cyan-50" },
  site: { icon: Globe, tone: "bg-teal-700/80 text-teal-50" },
};

/** What the owner can pick for a tile of their own. */
const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  workflow: Workflow,
  app: AppWindow,
  wand: WandSparkles,
  code: CodeXml,
  shapes: Shapes,
  mail: Mail,
  calendar: CalendarDays,
  chart: ChartLine,
  book: BookOpen,
  megaphone: Megaphone,
  camera: Camera,
};

const TONES: Record<string, string> = {
  slate: "bg-slate-600/80 text-slate-50",
  sky: "bg-sky-600/80 text-sky-50",
  indigo: "bg-indigo-600/80 text-indigo-50",
  violet: "bg-violet-700/80 text-violet-50",
  pink: "bg-pink-600/80 text-pink-50",
  rose: "bg-rose-700/80 text-rose-50",
  orange: "bg-orange-700/80 text-orange-50",
  amber: "bg-amber-600/80 text-amber-50",
  emerald: "bg-emerald-700/80 text-emerald-50",
  teal: "bg-teal-700/80 text-teal-50",
};

const workflowLook = (workflow: StudioWorkflow) => ({
  icon:
    ICONS[workflow.icon] ?? (workflow.kind === "app" ? AppWindow : Workflow),
  tone: TONES[workflow.tone] ?? TONES.slate,
});

/** Things asked for and not yet in Artifacts (this session). */
type Pending = {
  id: string;
  icon: LucideIcon;
  tone: string;
  brief: string;
  at: number;
};
let pending: Pending[] = [];
const listeners = new Set<() => void>();
const PENDING_EXPIRES_MS = 3 * 60 * 60_000;

function addPending(item: Pending) {
  pending = [...pending, item];
  for (const listener of listeners) listener();
}

function usePending(): Pending[] {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => pending,
  );
}

type Chosen =
  | { type: "kind"; kind: MakeKind }
  | { type: "workflow"; workflow: StudioWorkflow };

/** A Studio tile: a coloured square with its icon, the name under it. */
function Tile({
  icon: Icon,
  tone,
  label,
  selected,
  onClick,
  badge,
  menu,
  testId,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  selected?: boolean;
  onClick: () => void;
  badge?: string;
  menu?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="group relative flex w-28 flex-col gap-1.5">
      <button
        aria-pressed={selected}
        className="flex flex-col gap-1.5 text-left"
        data-testid={testId}
        onClick={onClick}
        type="button"
      >
        <span
          className={cn(
            "flex h-20 w-28 items-center justify-center rounded-xl transition-transform group-hover:-translate-y-0.5",
            tone,
            selected &&
              "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <Icon className="h-8 w-8" />
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <span className="truncate">{label}</span>
          {badge ? (
            <span className="shrink-0 rounded bg-muted px-1 text-2xs uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </span>
      </button>
      {menu}
    </div>
  );
}

/**
 * The Studio, at the top of Artifacts: pick what to make, describe it, and
 * an agent makes it with its own tools and publishes it here. Until it
 * arrives it shows as in the works. The owner's own workflows and apps sit
 * after the built-in tiles; + adds one.
 */
export function StudioMake({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: Artifact[];
  /** Open an artifact here (an app tile whose app is built). */
  onOpenArtifact: (id: string) => void;
}) {
  const client = useQueryClient();
  const { agents } = useOfficeAgents();
  const michael = agents.find((agent) => agent.isGod);
  const { data: workflows = [] } = useStudioWorkflows();
  const { data: codebases = [] } = useCodebases();
  const [chosen, setChosen] = React.useState<Chosen | null>(null);
  const [brief, setBrief] = React.useState("");
  const [codebaseId, setCodebaseId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Partial<StudioWorkflow> | null>(
    null,
  );
  const codebase = codebases.find((c) => c.id === codebaseId) ?? null;
  const all = usePending();
  // Each artifact published after a request clears the oldest one still
  // open: the n-th oldest goes once n have arrived since it was asked.
  const now = Date.now();
  const inTheWorks = all
    .filter((item) => now - item.at < PENDING_EXPIRES_MS)
    .filter(
      (item, index) =>
        artifacts.filter((a) => a.createdAt > item.at).length <= index,
    );

  const send = useMutation({
    mutationFn: (input: {
      text: string;
      pending: Omit<Pending, "id" | "at">;
    }) =>
      callOffice<boolean>("agent.message", {
        id: michael?.id ?? "god",
        text: input.text,
      }),
    onSuccess: (_result, input) => {
      addPending({ ...input.pending, id: `${Date.now()}`, at: Date.now() });
      setBrief("");
      setChosen(null);
      toast(`${michael?.name ?? "CEO"} is on it.`, {
        description: "It shows up here when it's ready.",
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const builtApp = (workflow: StudioWorkflow) =>
    artifacts.find((a) => a.title.trim() === workflow.name.trim());

  const buildApp = (workflow: StudioWorkflow) =>
    send.mutate({
      text: appRequest(workflow, "buzz-show", codebase),
      pending: {
        ...workflowLook(workflow),
        brief: `Building ${workflow.name}`,
      },
    });

  const submit = () => {
    if (!chosen) return;
    if (chosen.type === "kind") {
      if (!brief.trim()) return;
      send.mutate({
        text: makeRequest(chosen.kind, brief, "buzz-show", codebase),
        pending: { ...TILES[chosen.kind], brief: brief.trim() },
      });
    } else if (chosen.workflow.kind === "app") {
      buildApp(chosen.workflow);
    } else {
      send.mutate({
        text: workflowRequest(chosen.workflow, brief, "buzz-show", codebase),
        pending: {
          ...workflowLook(chosen.workflow),
          brief: brief.trim() || chosen.workflow.name,
        },
      });
    }
  };

  const remove = useMutation({
    mutationFn: (workflow: StudioWorkflow) => deleteWorkflow(workflow.id),
    onSuccess: (_r, workflow) => {
      void client.invalidateQueries({ queryKey: WORKFLOWS_KEY });
      if (chosen?.type === "workflow" && chosen.workflow.id === workflow.id)
        setChosen(null);
      toast(`Removed ${workflow.name}.`);
    },
    onError: (error) => toast.error(String(error)),
  });

  const [linkingCode, setLinkingCode] = React.useState(false);
  const selectedKind =
    chosen?.type === "kind"
      ? MAKE_KINDS.find((k) => k.kind === chosen.kind)
      : null;
  const selectedWorkflow = chosen?.type === "workflow" ? chosen.workflow : null;

  return (
    <section className="flex flex-col gap-3" data-testid="studio-make">
      <AddCodebaseDialog onOpenChange={setLinkingCode} open={linkingCode} />
      <SubsectionLabel>Make something new</SubsectionLabel>
      <div className="flex flex-wrap gap-3">
        {MAKE_KINDS.map(({ kind: k, label }) => (
          <Tile
            {...TILES[k]}
            key={k}
            label={label}
            onClick={() => {
              // Document, Slides and Chart open their Office-style editor.
              const editor = EDITOR_FOR[k];
              if (editor) {
                setChosen(null);
                openEditor({ kind: editor, title: "", file: blankFile(editor) });
                return;
              }
              setChosen(
                chosen?.type === "kind" && chosen.kind === k
                  ? null
                  : { type: "kind", kind: k },
              );
            }}
            selected={chosen?.type === "kind" && chosen.kind === k}
            testId={`studio-make-${k}`}
          />
        ))}
        {/* Link a codebase (GitHub or a folder) to build and run it. */}
        <Tile
          icon={FolderGit2}
          label="Code"
          onClick={() => setLinkingCode(true)}
          testId="codebase-add"
          tone="bg-indigo-700/80 text-indigo-50"
        />
        {workflows.map((workflow) => {
          const app = workflow.kind === "app" ? builtApp(workflow) : undefined;
          return (
            <Tile
              {...workflowLook(workflow)}
              badge={workflow.kind === "app" ? "App" : undefined}
              key={workflow.id}
              label={workflow.name}
              menu={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`${workflow.name}: more`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/25 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                      type="button"
                    >
                      <Ellipsis className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {workflow.kind === "app" && app ? (
                      <DropdownMenuItem onSelect={() => buildApp(workflow)}>
                        <RefreshCw />
                        Build it again
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => setEditing(workflow)}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => remove.mutate(workflow)}
                    >
                      <Trash2 />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
              onClick={() => {
                if (app) return onOpenArtifact(app.id);
                setChosen(
                  selectedWorkflow?.id === workflow.id
                    ? null
                    : { type: "workflow", workflow },
                );
              }}
              selected={selectedWorkflow?.id === workflow.id}
              testId={`studio-workflow-${workflow.id}`}
            />
          );
        })}
        <button
          className="group flex w-28 flex-col gap-1.5 text-left"
          data-testid="studio-add-workflow"
          onClick={() =>
            setEditing({ kind: "workflow", icon: "workflow", tone: "slate" })
          }
          type="button"
        >
          <span className="flex h-20 w-28 items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors group-hover:border-foreground/40 group-hover:text-foreground">
            <Plus className="h-7 w-7" />
          </span>
          <span className="text-sm text-muted-foreground">Your own</span>
        </button>
      </div>
      {chosen ? (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card/40 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {selectedWorkflow?.kind === "app" ? (
            <p className="text-sm">
              <span className="font-medium">{selectedWorkflow.name}</span> isn't
              built yet.{" "}
              <span className="text-muted-foreground">
                {selectedWorkflow.instructions}
              </span>
            </p>
          ) : (
            <Textarea
              autoFocus
              className="min-h-20 resize-y"
              data-testid="studio-brief"
              onChange={(event) => setBrief(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={
                selectedKind
                  ? `Describe the ${selectedKind.label.toLowerCase()}: ${selectedKind.placeholder}`
                  : `Anything for this run of ${selectedWorkflow?.name} (optional)`
              }
              value={brief}
            />
          )}
          {codebases.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5"
              data-testid="studio-codebase"
            >
              <span className="text-xs text-muted-foreground">
                In the look of
              </span>
              {[null, ...codebases].map((c) => (
                <button
                  aria-pressed={codebaseId === (c?.id ?? null)}
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-xs transition-colors",
                    codebaseId === (c?.id ?? null)
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/70 text-muted-foreground hover:text-foreground",
                  )}
                  key={c?.id ?? "none"}
                  onClick={() => setCodebaseId(c?.id ?? null)}
                  type="button"
                >
                  {c ? c.name : "No codebase"}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground">
              {michael?.name ?? "CEO"} makes it (or hands it to the right
              agent) and it appears here.
            </p>
            <Button
              data-testid="studio-make-send"
              disabled={
                (selectedKind ? !brief.trim() : false) || send.isPending
              }
              type="submit"
            >
              {send.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {selectedWorkflow?.kind === "app"
                ? "Build it"
                : selectedWorkflow
                  ? "Run it"
                  : "Make it"}
            </Button>
          </div>
        </form>
      ) : null}
      {inTheWorks.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {inTheWorks.map((item) => {
            const Icon = item.icon;
            return (
              <div
                className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-card/30 p-3"
                data-testid="studio-pending"
                key={item.id}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    item.tone,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {item.brief}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    In the works
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <WorkflowDialog onClose={() => setEditing(null)} workflow={editing} />
    </section>
  );
}

/** Add or change one of the owner's own tiles. */
function WorkflowDialog({
  workflow,
  onClose,
}: {
  workflow: Partial<StudioWorkflow> | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = React.useState<Partial<StudioWorkflow>>({});
  React.useEffect(() => {
    if (workflow) setDraft(workflow);
  }, [workflow]);
  const isApp = draft.kind === "app";
  const save = useMutation({
    mutationFn: () => saveWorkflow(draft),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: WORKFLOWS_KEY });
      toast(workflow?.id ? `Saved ${saved.name}.` : `Added ${saved.name}.`);
      onClose();
    },
    onError: (error) => toast.error(String(error)),
  });
  const set = (patch: Partial<StudioWorkflow>) =>
    setDraft((d) => ({ ...d, ...patch }));
  const Icon = ICONS[draft.icon ?? ""] ?? Workflow;

  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      open={workflow !== null}
    >
      <DialogContent
        className="sm:max-w-lg"
        data-testid="studio-workflow-dialog"
      >
        <DialogHeader>
          <DialogTitle>{workflow?.id ? "Edit" : "Add your own"}</DialogTitle>
          <DialogDescription>
            A workflow is something the agents do for you each time you run it.
            An app is a tool they build once; its tile then opens it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          id="studio-workflow-form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["workflow", "app"] as const).map((kind) => (
              <button
                aria-pressed={(draft.kind ?? "workflow") === kind}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded-md text-sm transition-colors",
                  (draft.kind ?? "workflow") === kind
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={kind}
                onClick={() => set({ kind })}
                type="button"
              >
                {kind === "app" ? (
                  <AppWindow className="h-4 w-4" />
                ) : (
                  <Workflow className="h-4 w-4" />
                )}
                {kind === "app" ? "App" : "Workflow"}
              </button>
            ))}
          </div>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-14 w-16 shrink-0 items-center justify-center rounded-xl",
                TONES[draft.tone ?? "slate"] ?? TONES.slate,
              )}
            >
              <Icon className="h-6 w-6" />
            </span>
            <Input
              autoFocus
              data-testid="studio-workflow-name"
              onChange={(event) => set({ name: event.target.value })}
              placeholder={isApp ? "Habit tracker" : "Weekly report"}
              value={draft.name ?? ""}
            />
          </div>
          <Textarea
            className="min-h-28 resize-y"
            data-testid="studio-workflow-instructions"
            onChange={(event) => set({ instructions: event.target.value })}
            placeholder={
              isApp
                ? "What the app does and how it should work: a habit tracker with daily check-ins, streaks and a month view."
                : "What the agent does each time, step by step, and what it hands you: pull last week's numbers from our sales sheet, chart them, write three takeaways, make it a one-page PDF."
            }
            value={draft.instructions ?? ""}
          />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ICONS).map(([key, I]) => (
                <button
                  aria-label={key}
                  aria-pressed={draft.icon === key}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                    draft.icon === key
                      ? "border-primary bg-primary/10"
                      : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                  key={key}
                  onClick={() => set({ icon: key })}
                  type="button"
                >
                  <I className="h-4 w-4" />
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(TONES).map(([key, tone]) => (
                <button
                  aria-label={key}
                  aria-pressed={draft.tone === key}
                  className={cn(
                    "h-6 w-6 rounded-full",
                    tone,
                    draft.tone === key &&
                      "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                  key={key}
                  onClick={() => set({ tone: key })}
                  type="button"
                />
              ))}
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            data-testid="studio-workflow-save"
            disabled={
              !draft.name?.trim() ||
              !draft.instructions?.trim() ||
              save.isPending
            }
            form="studio-workflow-form"
            type="submit"
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            {workflow?.id ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Under an opened artifact: ask whoever made it for changes. */
export function AskForChanges({ item }: { item: Artifact }) {
  const { agents } = useOfficeAgents();
  const maker =
    agents.find((agent) => agent.id === item.agentId) ??
    agents.find((agent) => agent.isGod);
  const [ask, setAsk] = React.useState("");
  const send = useMutation({
    mutationFn: (text: string) =>
      callOffice<boolean>("agent.message", {
        id: maker?.id ?? "god",
        text: changeRequest(item, text),
      }),
    onSuccess: () => {
      setAsk("");
      toast(`${maker?.name ?? "CEO"} is making the changes.`, {
        description: "The new version shows up in Create.",
      });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <form
      className="flex items-end gap-2 rounded-2xl border border-border/70 bg-card/40 p-2"
      data-testid="artifact-ask-changes"
      onSubmit={(event) => {
        event.preventDefault();
        if (ask.trim()) send.mutate(ask.trim());
      }}
    >
      <Textarea
        className="min-h-10 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        onChange={(event) => setAsk(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (ask.trim()) send.mutate(ask.trim());
          }
        }}
        placeholder={`Ask ${maker?.name ?? "CEO"} for changes…`}
        rows={1}
        value={ask}
      />
      <Button
        aria-label="Send"
        disabled={!ask.trim() || send.isPending}
        size="icon"
        type="submit"
      >
        {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
      </Button>
    </form>
  );
}
