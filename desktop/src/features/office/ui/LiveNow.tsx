import * as React from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Box, Clapperboard, FileText, Globe, ImageIcon, Radio, X } from "lucide-react";

import { EditorFileView } from "@/features/office/editors/EditorFiles";
import { type AgentPresence, type OfficeAgent, useOfficeAgents } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";

const ModelViewer = React.lazy(async () => ({ default: (await import("./ModelViewer")).ModelViewer }));

/** What an agent is doing, from the Office (see office/src/shared/presence.ts). */
export type Presence = AgentPresence;
export type LiveKind = NonNullable<AgentPresence["latest"]>["kind"];

type LiveAgent = OfficeAgent & { presence: Presence };

export function sinceLabel(since: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - since) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `for ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `for ${h} h${r ? ` ${r} min` : ""}`;
}

const isLive = (a: LiveAgent, now: number) =>
  a.status === "working" && !a.presence.idleSince && now - a.presence.lastAt < 20 * 60_000;

const KIND_ICON: Record<LiveKind, typeof Box> = {
  model: Box,
  image: ImageIcon,
  video: Clapperboard,
  site: Globe,
  pdf: FileText,
  editor: FileText,
  text: FileText,
};

function useNow(ms = 30_000) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The file, kept fresh: re-checked every 2 s, reloaded when it changes. */
function useLiveFile(path: string | undefined) {
  const [state, setState] = React.useState<{ mtime: number; error?: string } | null>(null);
  React.useEffect(() => {
    if (!path) return;
    let alive = true;
    const check = () =>
      invoke<{ mtime: number }>("office_live_file", { path })
        .then((r) => alive && setState((s) => (s?.mtime === r.mtime ? s : { mtime: r.mtime })))
        .catch((e) => alive && setState({ mtime: 0, error: String(e) }));
    void check();
    const t = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path]);
  return state;
}

/** Create's "Live now": agents at work, like streams on Discord. */
export function LiveNow() {
  const { agents } = useOfficeAgents();
  const now = useNow();
  const [watching, setWatching] = React.useState<string | null>(null);
  const live = (agents as LiveAgent[]).filter((a) => a.presence && isLive(a, now));
  const watched = (agents as LiveAgent[]).find((a) => a.id === watching && a.presence);
  return (
    <>
      <ToolFeedback />
      {live.length ? (
        <section className="space-y-2" data-testid="create-live-now">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Live now
          </div>
          <div className="flex flex-wrap gap-3">
            {live.map((a) => (
              <LiveCard agent={a} key={a.id} now={now} onWatch={() => setWatching(a.id)} />
            ))}
          </div>
        </section>
      ) : null}
      {watched ? <LiveWatch agent={watched} onClose={() => setWatching(null)} /> : null}
    </>
  );
}

function LiveCard({ agent, now, onWatch }: { agent: LiveAgent; now: number; onWatch: () => void }) {
  const p = agent.presence;
  const Icon = p.latest ? KIND_ICON[p.latest.kind] : Radio;
  return (
    <button
      className="group w-64 overflow-hidden rounded-lg border border-border/70 bg-card text-left shadow-sm transition hover:border-red-500/60 hover:shadow-md"
      onClick={onWatch}
      title={`Watch ${agent.name}`}
      type="button"
    >
      <div className="relative flex h-32 items-center justify-center overflow-hidden bg-[#1e1f22]">
        {p.latest?.kind === "image" ? (
          <LiveImage path={p.latest.path} />
        ) : (
          <Icon className="h-10 w-10 text-white/40 transition group-hover:scale-110 group-hover:text-white/70" />
        )}
        <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Live
        </span>
        <span className="absolute bottom-2 left-2 right-2 truncate text-[11px] text-white/80 drop-shadow">
          {p.latest ? p.latest.path.replace(/\\/g, "/").split("/").pop() : p.steps.at(-1)?.text}
        </span>
      </div>
      <div className="flex items-start gap-2 p-2.5">
        <span className="mt-0.5 h-7 w-7 shrink-0 rounded-full text-center text-xs font-bold leading-7 text-white" style={{ background: agent.accent?.startsWith("#") ? agent.accent : "#5865f2" }}>
          {agent.name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{agent.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {p.activity}
            {p.detail ? ` · ${p.detail}` : ""}
          </div>
          <div className="text-[11px] text-muted-foreground/80">{sinceLabel(p.since, now)}</div>
        </div>
      </div>
    </button>
  );
}

function LiveImage({ path }: { path: string }) {
  const f = useLiveFile(path);
  if (!f || f.error) return null;
  return <img alt="" className="h-full w-full object-cover" src={`${convertFileSrc(path)}?v=${f.mtime}`} />;
}

/** Watching an agent: their work, live, in the tool it belongs to, with what
 *  they're doing beside it. */
function LiveWatch({ agent, onClose }: { agent: LiveAgent; onClose: () => void }) {
  const p = agent.presence;
  const now = useNow(15_000);
  const file = useLiveFile(p.latest?.path);
  const working = isLive(agent, now);
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const src = p.latest && file && !file.error ? `${convertFileSrc(p.latest.path)}?v=${file.mtime}` : null;
  const name = p.latest?.path.replace(/\\/g, "/").split("/").pop();
  let stage: React.ReactNode = (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/50">
      <Radio className="h-8 w-8" />
      {p.latest ? (file?.error ?? "Loading…") : "Nothing to show yet: the picture appears as soon as they write a model, image, video, page or document."}
    </div>
  );
  if (src && p.latest) {
    const k = p.latest.kind;
    if (k === "model") {
      stage = (
        <React.Suspense fallback={null}>
          <ModelViewer className="h-full w-full" key={src} path={p.latest.path} src={src} />
        </React.Suspense>
      );
    } else if (k === "image") stage = <img alt="" className="h-full w-full object-contain" src={src} />;
    // biome-ignore lint/a11y/useMediaCaption: an agent's work in progress
    else if (k === "video") stage = <video autoPlay className="h-full w-full" controls key={src} loop muted src={src} />;
    else if (k === "site" || k === "pdf") stage = <iframe className="h-full w-full bg-white" key={src} src={src} title={name ?? "Live"} />;
    else if (k === "editor") {
      stage = (
        <div className="h-full overflow-auto bg-[#f3f3f3]" key={src}>
          <EditorFileView item={{ id: `live-${agent.id}`, title: name ?? "Live", path: p.latest.path }} />
        </div>
      );
    } else stage = <TextStage src={src} />;
  }
  return (
    <div className="fixed inset-0 z-50 flex bg-black/70 p-4 backdrop-blur-sm" data-testid="live-watch">
      <div className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#111214] shadow-2xl">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-sm text-white">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", working ? "bg-red-600" : "bg-white/20")}>{working ? "Live" : "Paused"}</span>
            <span className="font-semibold">{agent.name}</span>
            <span className="text-white/60">· {p.activity}{p.detail ? ` · ${p.detail}` : ""}</span>
            <span className="ml-auto truncate text-xs text-white/50">{name}</span>
            <button aria-label="Stop watching" className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white" onClick={onClose} type="button">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1">{stage}</div>
        </div>
        <aside className="flex w-72 shrink-0 flex-col border-l border-white/10 text-white">
          <div className="border-b border-white/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-[#23a55a]">{working ? p.activity : `Was ${p.activity.toLowerCase()}`}</div>
            {p.detail ? <div className="mt-0.5 font-semibold">{p.detail}</div> : null}
            <div className="text-xs text-white/60">{working ? sinceLabel(p.since, now) : `idle ${sinceLabel(p.idleSince ?? p.lastAt, now).replace("for ", "")}`}</div>
          </div>
          <div className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wide text-white/50">What they're doing</div>
          <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4 text-xs">
            {[...p.steps].reverse().map((s, i) => (
              <li className={cn("flex gap-2", i === 0 ? "text-white" : "text-white/60")} key={`${s.ts}-${i}`}>
                <span className="w-12 shrink-0 tabular-nums text-white/40">{ago(s.ts, now)}</span>
                <span className="min-w-0 break-words">{s.text}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function TextStage({ src }: { src: string }) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    fetch(src)
      .then((r) => r.text())
      .then((t) => setText(t.slice(0, 200_000)))
      .catch(() => {});
  }, [src]);
  return <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-xs text-white/80">{text}</pre>;
}

type Feedback = { ts: string; agent: string; tool: string; rating: "works" | "rough" | "broken"; what: string; fix?: string };

/** What agents said about the office's tools (buzz-feedback): what to fix. */
function ToolFeedback() {
  const [items, setItems] = React.useState<Feedback[]>([]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<Feedback[]>("office_tool_feedback")
        .then((r) => alive && setItems(r))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!items.length) return null;
  const problems = items.filter((f) => f.rating !== "works");
  const tools = [...new Set(items.map((f) => f.tool))];
  return (
    <>
      <div className="-mb-2 flex justify-end">
        <button className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setOpen(true)} type="button">
          Tool feedback from agents · {problems.length} {problems.length === 1 ? "problem" : "problems"}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setOpen(false)} onKeyDown={() => {}} role="presentation">
          <div className="max-h-[80vh] w-[44rem] overflow-y-auto rounded-xl border bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} onKeyDown={() => {}} role="dialog">
            <div className="mb-3 flex items-center">
              <h3 className="text-base font-semibold">Tool feedback</h3>
              <button aria-label="Close" className="ml-auto rounded p-1 hover:bg-muted" onClick={() => setOpen(false)} type="button">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              What agents said after using the office's tools. Agents read the same list before using a tool, so known problems carry their workarounds.
            </p>
            {tools.map((tool) => {
              const all = items.filter((f) => f.tool === tool);
              const bad = all.filter((f) => f.rating !== "works").reverse();
              const n = (r: string) => all.filter((f) => f.rating === r).length;
              return (
                <section className="mb-4" key={tool}>
                  <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                    {tool}
                    <span className="text-xs font-normal text-muted-foreground">
                      {n("works")} works · {n("rough")} rough · {n("broken")} broken
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {bad.slice(0, 10).map((f, i) => (
                      <li className="rounded-md border px-3 py-2 text-sm" key={`${f.ts}-${i}`}>
                        <span className={cn("mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white", f.rating === "broken" ? "bg-red-600" : "bg-amber-600")}>{f.rating}</span>
                        {f.what}
                        {f.fix ? <div className="mt-1 text-xs text-muted-foreground">Would help: {f.fix}</div> : null}
                        <div className="mt-1 text-[11px] text-muted-foreground/80">
                          {f.agent} · {new Date(f.ts).toLocaleString()}
                        </div>
                      </li>
                    ))}
                    {!bad.length ? <li className="text-xs text-muted-foreground">No problems reported.</li> : null}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
