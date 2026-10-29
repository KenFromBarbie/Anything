import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import {
  BarChart3,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Loader2,
  type LucideIcon,
  Presentation,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import {
  changeRequest,
  MAKE_KINDS,
  type MakeKind,
  makeRequest,
} from "@/features/office/lib/studioRequests";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

import type { Artifact } from "./ArtifactsPage";

const TILES: Record<MakeKind, { icon: LucideIcon; tone: string }> = {
  document: { icon: FileText, tone: "bg-sky-600/80 text-sky-50" },
  slides: { icon: Presentation, tone: "bg-orange-700/80 text-orange-50" },
  chart: { icon: BarChart3, tone: "bg-rose-700/80 text-rose-50" },
  image: { icon: ImageIcon, tone: "bg-emerald-700/80 text-emerald-50" },
  video: { icon: Film, tone: "bg-violet-700/80 text-violet-50" },
  site: { icon: Globe, tone: "bg-teal-700/80 text-teal-50" },
};

/** Things asked for and not yet in Artifacts (this session). */
type Pending = { id: string; kind: MakeKind; brief: string; at: number };
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

/**
 * The Studio, at the top of Artifacts: pick what to make, describe it, and
 * an agent makes it with its own tools and publishes it here. Until it
 * arrives it shows as in the works.
 */
export function StudioMake({ artifacts }: { artifacts: Artifact[] }) {
  const { agents } = useOfficeAgents();
  const michael = agents.find((agent) => agent.isGod);
  const [kind, setKind] = React.useState<MakeKind | null>(null);
  const [brief, setBrief] = React.useState("");
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
  const make = useMutation({
    mutationFn: (input: { kind: MakeKind; brief: string }) =>
      callOffice<boolean>("agent.message", {
        id: michael?.id ?? "god",
        text: makeRequest(input.kind, input.brief),
      }),
    onSuccess: (_result, input) => {
      addPending({
        id: `${Date.now()}`,
        kind: input.kind,
        brief: input.brief,
        at: Date.now(),
      });
      setBrief("");
      setKind(null);
      toast(`${michael?.name ?? "Michael"} is on it.`, {
        description: "It shows up here when it's ready.",
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const chosen = MAKE_KINDS.find((k) => k.kind === kind);

  return (
    <section className="flex flex-col gap-3" data-testid="studio-make">
      <SubsectionLabel>Make something new</SubsectionLabel>
      <div className="flex flex-wrap gap-3">
        {MAKE_KINDS.map(({ kind: k, label }) => {
          const { icon: Icon, tone } = TILES[k];
          return (
            <button
              aria-pressed={kind === k}
              className="group flex w-28 flex-col gap-1.5 text-left"
              data-testid={`studio-make-${k}`}
              key={k}
              onClick={() => setKind(kind === k ? null : k)}
              type="button"
            >
              <span
                className={cn(
                  "flex h-20 w-28 items-center justify-center rounded-xl transition-transform group-hover:-translate-y-0.5",
                  tone,
                  kind === k &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
              >
                <Icon className="h-8 w-8" />
              </span>
              <span className="text-sm">{label}</span>
            </button>
          );
        })}
      </div>
      {chosen ? (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card/40 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (brief.trim())
              make.mutate({ kind: chosen.kind, brief: brief.trim() });
          }}
        >
          <Textarea
            autoFocus
            className="min-h-20 resize-y"
            data-testid="studio-brief"
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (brief.trim())
                  make.mutate({ kind: chosen.kind, brief: brief.trim() });
              }
            }}
            placeholder={`Describe the ${chosen.label.toLowerCase()}: ${chosen.placeholder}`}
            value={brief}
          />
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground">
              {michael?.name ?? "Michael"} makes it (or hands it to the right
              agent) and it appears here.
            </p>
            <Button
              data-testid="studio-make-send"
              disabled={!brief.trim() || make.isPending}
              type="submit"
            >
              {make.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              Make it
            </Button>
          </div>
        </form>
      ) : null}
      {inTheWorks.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {inTheWorks.map((item) => {
            const { icon: Icon, tone } = TILES[item.kind];
            return (
              <div
                className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-card/30 p-3"
                data-testid="studio-pending"
                key={item.id}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    tone,
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
    </section>
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
      toast(`${maker?.name ?? "Michael"} is making the changes.`, {
        description: "The new version shows up in Artifacts.",
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
        placeholder={`Ask ${maker?.name ?? "Michael"} for changes…`}
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
