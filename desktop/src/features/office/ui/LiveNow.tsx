import * as React from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Box, Clapperboard, FileText, Globe, ImageIcon, Radio, X } from "lucide-react";

import { EditorFileView, LiveFileEditor } from "@/features/office/editors/EditorFiles";
import { blankModel, type ModelFile, parseModel } from "@/features/office/editors/modelFormat";
import { useOpenAgentDm } from "@/features/office/lib/agentDm";
import { type AgentPresence, type OfficeAgent, useOfficeAgents } from "@/features/office/lib/officeLink";
import { foldDiff, lineDiff } from "@/features/office/lib/lineDiff";
import { cn } from "@/shared/lib/cn";

const ModelEditor = React.lazy(async () => ({ default: (await import("@/features/office/editors/ModelEditor")).ModelEditor }));
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
  const dm = useOpenAgentDm();
  const live = (agents as LiveAgent[]).filter((a) => a.presence && isLive(a, now));
  // One stream per piece of work, like a shared document: agents on the same
  // file are one stream with all of them in it.
  // Only work there is something to watch of is a stream; agents with nothing
  // on screen yet (reading, running checks) are listed beside them instead.
  const groups = groupByFile(live);
  const streams = groups.filter((g) => g.key.startsWith("file:"));
  const busy = groups.filter((g) => !g.key.startsWith("file:")).flatMap((g) => g.agents);
  const watched = streams.find((g) => g.key === watching) ?? null;
  return (
    <>
      <ToolFeedback />
      {streams.length || busy.length ? (
        <section className="space-y-2" data-testid="create-live-now">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Live now · {streams.length} {streams.length === 1 ? "stream" : "streams"} · {live.length} {live.length === 1 ? "agent" : "agents"}
          </div>
          {busy.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="live-also-working">
              <span>Also working:</span>
              {busy.map((a) => (
                <button
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 hover:bg-muted"
                  key={a.id}
                  onClick={() => void dm.open(a)}
                  title={`${a.presence.steps.at(-1)?.text ?? a.presence.activity} · message ${a.name}`}
                  type="button"
                >
                  <AgentStack agents={[a]} size={16} />
                  <span className="font-medium text-foreground">{a.name}</span>
                  <span className="max-w-48 truncate">{a.presence.activity.toLowerCase()}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {streams.map((g) => (
              <LiveCard agents={g.agents} key={g.key} onMessage={(a) => void dm.open(a)} onWatch={() => setWatching(g.key)} />
            ))}
          </div>
        </section>
      ) : null}
      {/* Over the whole window (sidebar and rail included), not inside the page. */}
      {watched ? createPortal(<LiveWatch agents={watched.agents} onClose={() => setWatching(null)} />, document.body) : null}
    </>
  );
}

type Stream = { key: string; agents: LiveAgent[] };

/** Live agents by the file they're on (the most recently active first). */
function groupByFile(live: LiveAgent[]): Stream[] {
  const norm = (x: string) => x.split(String.fromCharCode(92)).join("/").toLowerCase();
  const by = new Map<string, LiveAgent[]>();
  for (const a of live) {
    const key = a.presence.latest ? `file:${norm(a.presence.latest.path)}` : `agent:${a.id}`;
    by.set(key, [...(by.get(key) ?? []), a]);
  }
  return [...by.entries()].map(([key, list]) => ({
    key,
    agents: [...list].sort((x, y) => y.presence.lastAt - x.presence.lastAt),
  }));
}

/** Overlapping initials, like the people in a shared document. */
function AgentStack({ agents, size = 20 }: { agents: LiveAgent[]; size?: number }) {
  return (
    <span className="flex -space-x-1.5">
      {agents.slice(0, 5).map((a) => (
        <span
          className="flex items-center justify-center rounded-full border-2 border-[#2b2d31] font-semibold text-white"
          key={a.id}
          style={{ width: size, height: size, fontSize: size * 0.45, background: a.accent?.startsWith("#") ? a.accent : "#5865f2" }}
          title={a.name}
        >
          {a.name.trim().charAt(0).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

/** Elapsed time, Discord style: 21:01, 1:04:09. */
export function clock(since: number, now = Date.now()): string {
  const t = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
}

const KIND_APP: Record<LiveKind, { name: string; color: string }> = {
  model: { name: "3D", color: "#E8873A" },
  image: { name: "Image", color: "#2F7FE8" },
  video: { name: "Video", color: "#9B5DE5" },
  site: { name: "Site", color: "#14A39A" },
  pdf: { name: "Document", color: "#185ABD" },
  editor: { name: "Editor", color: "#185ABD" },
  text: { name: "Code", color: "#5865F2" },
};

/** An agent at work, like a stream on Discord: their work live on top, then
 *  a rich-presence card (what, in which tool, for how long). */
function LiveCard({ agents, onWatch, onMessage }: { agents: LiveAgent[]; onWatch: () => void; onMessage: (agent: LiveAgent) => void }) {
  const agent = agents[0]!;
  const p = agent.presence;
  const names = agents.map((a) => a.name).join(", ");
  const now = useNow(1000);
  const kind = p.latest?.kind;
  const Icon = kind ? KIND_ICON[kind] : Radio;
  const app = kind ? KIND_APP[kind] : { name: "Terminal", color: "#5865F2" };
  const file = p.latest ? p.latest.path.replace(/\\/g, "/").split("/").pop() : null;
  const last = p.steps.at(-1)?.text;
  return (
    <div className="w-72 overflow-hidden rounded-lg bg-[#2b2d31] text-white shadow-md ring-1 ring-black/20" data-testid="live-card">
      <button className="group relative block h-40 w-full overflow-hidden bg-[#1e1f22]" onClick={onWatch} title={`Watch ${names}`} type="button">
        <LiveThumb fallback={<Icon className="h-10 w-10 text-white/30" />} latest={p.latest ?? null} />
        <span className="absolute left-2 top-2 rounded bg-[#ed4245] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Live</span>
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold opacity-0 transition group-hover:opacity-100">Watch stream</span>
      </button>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-white/90">
          <span className="truncate">{p.activity}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-normal text-white/60" title={names}>
            <AgentStack agents={agents} size={18} />
            <span className="truncate">{agents.length > 1 ? `${agents.length} working` : agent.name}</span>
          </span>
        </div>
        <div className="flex gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg" style={{ background: `${app.color}2e`, boxShadow: `inset 0 0 0 1.5px ${app.color}66` }}>
            <Icon className="h-8 w-8" style={{ color: app.color }} />
          </div>
          <div className="min-w-0 text-[13px] leading-snug">
            <div className="truncate font-semibold">{p.detail || file || app.name}</div>
            <div className="truncate text-white/75">{file && p.detail ? file : app.name}</div>
            <div className="truncate text-white/60" title={last}>{last ?? "Starting…"}</div>
            <div className="mt-0.5 flex items-center gap-1 text-xs tabular-nums text-[#3ba55d]">
              <Radio className="h-3 w-3" />
              {clock(p.since, now)}
              {p.changes?.count ? (
                <span className="ml-2 font-mono text-[11px]">
                  <span className="text-[#3ba55d]">+{p.changes.added}</span> <span className="text-[#ed4245]">−{p.changes.removed}</span>
                  <span className="text-white/50"> · {p.changes.files} file{p.changes.files === 1 ? "" : "s"}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <button className="h-8 rounded-md bg-[#4e5058] text-sm font-medium hover:bg-[#6d6f78]" onClick={onWatch} type="button">
            Watch stream
          </button>
          <div className="flex gap-1.5">
            {agents.slice(0, 3).map((a) => (
              <button className="h-8 min-w-0 flex-1 truncate rounded-md bg-[#4e5058] px-2 text-sm font-medium hover:bg-[#6d6f78]" key={a.id} onClick={() => onMessage(a)} type="button">
                Message {a.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small live picture of the agent's latest work, refreshed as it changes. */
function LiveThumb({ latest, fallback }: { latest: Presence["latest"] | null; fallback: React.ReactNode }) {
  const f = useLiveFile(latest?.path);
  if (!latest || !f || f.error) return <div className="flex h-full items-center justify-center">{fallback}</div>;
  const src = `${convertFileSrc(latest.path)}?v=${f.mtime}`;
  const k = latest.kind;
  if (k === "image") return <img alt="" className="h-full w-full object-cover" src={src} />;
  // biome-ignore lint/a11y/useMediaCaption: a silent preview of work in progress
  if (k === "video") return <video autoPlay className="h-full w-full object-cover" key={src} loop muted playsInline src={src} />;
  if (k === "site" || k === "pdf") {
    return <iframe className="pointer-events-none h-[400%] w-[400%] origin-top-left border-0 bg-white" key={src} sandbox="" src={src} style={{ transform: "scale(0.25)" }} tabIndex={-1} title="Live" />;
  }
  if (k === "editor") {
    return (
      <div className="pointer-events-none relative h-full w-full overflow-hidden bg-white" key={src}>
        <EditorFileView item={{ id: `thumb-${latest.path}`, title: "", path: latest.path }} thumb />
      </div>
    );
  }
  if (k === "model") {
    return (
      <React.Suspense fallback={<div className="flex h-full items-center justify-center">{fallback}</div>}>
        <ModelViewer className="pointer-events-none h-full w-full" key={src} path={latest.path} src={src} />
      </React.Suspense>
    );
  }
  return <TextThumb src={src} />;
}

/** The end of a text/code file, like a terminal. */
function TextThumb({ src }: { src: string }) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    fetch(src)
      .then((r) => r.text())
      .then((t) => setText(t.split("\n").slice(-14).join("\n")))
      .catch(() => {});
  }, [src]);
  return <pre className="h-full w-full overflow-hidden p-2 text-left font-mono text-[9px] leading-tight text-[#9ece6a]">{text}</pre>;
}

/** Watching an agent: their work, live, in the tool it belongs to, with what
 *  they're doing beside it. */
function LiveWatch({ agents, onClose }: { agents: LiveAgent[]; onClose: () => void }) {
  const agent = agents[0]!;
  const p = agent.presence;
  const [view, setView] = React.useState<"live" | "changes">("live");
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
      // In the 3D editor itself (menus, scene tree, workspaces), reopened on
      // every new version the agent writes, so the changes show as they land.
      stage = <LiveModelEditor mtime={file?.mtime ?? 0} path={p.latest.path} />;
    } else if (k === "editor" && /\.model\.json$/i.test(p.latest.path)) {
      stage = <LiveModelEditor mtime={file?.mtime ?? 0} path={p.latest.path} />;
    } else if (k === "image") stage = <img alt="" className="h-full w-full object-contain" src={src} />;
    // biome-ignore lint/a11y/useMediaCaption: an agent's work in progress
    else if (k === "video") stage = <video autoPlay className="h-full w-full" controls key={src} loop muted src={src} />;
    else if (k === "site" || k === "pdf") stage = <iframe className="h-full w-full bg-white" key={src} src={src} title={name ?? "Live"} />;
    else if (k === "editor") {
      // The real editor, following the file: the agent's changes land in
      // place with their cursor, like a shared document.
      stage = <LiveFileEditor key={p.latest.path} path={p.latest.path} />;
    } else if (/\.(md|txt|csv)$/i.test(p.latest.path)) stage = <TextStage src={src} />;
    else stage = <CodeStage changesFile={p.changes?.file} changesAt={p.changes?.lastAt} path={p.latest.path} src={src} />;
  }
  return (
    <div className="fixed inset-0 z-[70] flex bg-black/70 p-4 backdrop-blur-sm" data-testid="live-watch">
      <div className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#111214] shadow-2xl">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-sm text-white">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", working ? "bg-red-600" : "bg-white/20")}>{working ? "Live" : "Paused"}</span>
            <AgentStack agents={agents} size={22} />
            <span className="font-semibold">{agents.map((a) => a.name).join(", ")}</span>
            <span className="text-white/60">· {p.activity}{p.detail ? ` · ${p.detail}` : ""}</span>
            <div className="ml-3 flex rounded-md bg-white/10 p-0.5 text-xs">
              <button className={cn("rounded px-2 py-0.5", view === "live" ? "bg-white/20 text-white" : "text-white/60")} onClick={() => setView("live")} type="button">
                Live view
              </button>
              <button className={cn("rounded px-2 py-0.5", view === "changes" ? "bg-white/20 text-white" : "text-white/60")} onClick={() => setView("changes")} type="button">
                Changes{p.changes?.count ? ` (${p.changes.count})` : ""}
              </button>
            </div>
            <span className="ml-auto truncate text-xs text-white/50">{name}</span>
            <button aria-label="Stop watching" className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white" onClick={onClose} type="button">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1">{view === "changes" ? <ChangesFeed changes={p.changes ?? null} roots={p.dirs} /> : stage}</div>
        </div>
        <aside className="flex w-72 shrink-0 flex-col border-l border-white/10 text-white">
          <div className="border-b border-white/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-[#23a55a]">{working ? p.activity : `Was ${p.activity.toLowerCase()}`}</div>
            {p.detail ? <div className="mt-0.5 font-semibold">{p.detail}</div> : null}
            <div className="text-xs text-white/60">{working ? sinceLabel(p.since, now) : `idle ${sinceLabel(p.idleSince ?? p.lastAt, now).replace("for ", "")}`}</div>
          </div>
          <div className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wide text-white/50">What they're doing</div>
          {agents.length > 1 ? (
            <div className="border-b border-white/10 px-4 py-3">
              <div className="pb-1.5 text-[10px] font-bold uppercase tracking-wide text-white/50">In this file</div>
              {agents.map((a) => (
                <div className="flex items-center gap-2 py-1 text-xs" key={a.id}>
                  <AgentStack agents={[a]} size={20} />
                  <span className="font-semibold">{a.name}</span>
                  <span className="min-w-0 flex-1 truncate text-white/60" title={a.presence.steps.at(-1)?.text}>
                    {a.presence.steps.at(-1)?.text ?? a.presence.activity}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4 text-xs">
            {agents
              .flatMap((a) => a.presence.steps.map((st) => ({ ...st, who: a })))
              .sort((x, y) => y.ts - x.ts)
              .slice(0, 80)
              .map((st, i) => (
                <li className={cn("flex gap-2", i === 0 ? "text-white" : "text-white/60")} key={`${st.who.id}-${st.ts}-${i}`}>
                  <span className="w-12 shrink-0 tabular-nums text-white/40">{ago(st.ts, now)}</span>
                  <span className="min-w-0 break-words">
                    {agents.length > 1 ? <span className="font-semibold text-white/80">{st.who.name}: </span> : null}
                    {st.text}
                  </span>
                </li>
              ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

type Change = { id: string; ts: number; tool: string; path: string; op: "created" | "edited" | "written" | "updated"; hunks: { old: string; new: string; line?: number }[]; added: number; removed: number; truncated?: boolean };

/** Everything the agent changed, newest first: pick a change to see its diff. */
function ChangesFeed({ changes, roots }: { changes: Presence["changes"] | null; roots: string[] }) {
  const f = useLiveFile(changes?.file);
  const [list, setList] = React.useState<Change[]>([]);
  const [sel, setSel] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!changes?.file || !f || f.error) return;
    let alive = true;
    fetch(`${convertFileSrc(changes.file)}?v=${f.mtime}`)
      .then((r) => r.text())
      .then((t) => {
        if (!alive) return;
        const rows: Change[] = [];
        for (const line of t.split("\n")) {
          if (!line.trim()) continue;
          try {
            rows.push(JSON.parse(line) as Change);
          } catch {
            /* a half-written line */
          }
        }
        setList(rows.reverse());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [changes?.file, f]);
  const rel = (path: string) => {
    const p = path.replace(/\\/g, "/");
    for (const r of roots) {
      const root = r.replace(/\\/g, "/").replace(/\/+$/, "");
      if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return p.slice(root.length + 1);
    }
    return p.split("/").slice(-3).join("/");
  };
  if (!changes?.count && !list.length) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-white/50">No file changes yet. Every file this agent writes or edits shows up here with what changed.</div>;
  }
  const picked = list.find((c) => c.id === sel) ?? list[0] ?? null;
  const OP: Record<Change["op"], string> = { created: "Created", edited: "Edited", written: "Rewrote", updated: "Updated" };
  return (
    <div className="flex h-full min-h-0">
      <ol className="w-72 shrink-0 overflow-y-auto border-r border-white/10 py-1 text-xs">
        {list.map((c) => (
          <li key={c.id}>
            <button className={cn("flex w-full flex-col gap-0.5 px-3 py-1.5 text-left", c.id === picked?.id ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5")} onClick={() => setSel(c.id)} type="button">
              <span className="flex items-center gap-2">
                <span className="truncate font-mono">{rel(c.path).split("/").pop()}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px]">
                  {c.added ? <span className="text-[#3ba55d]">+{c.added}</span> : null} {c.removed ? <span className="text-[#ed4245]">−{c.removed}</span> : null}
                </span>
              </span>
              <span className="flex gap-2 text-[10.5px] text-white/40">
                <span>{OP[c.op]}</span>
                <span className="truncate">{rel(c.path)}</span>
                <span className="ml-auto shrink-0">{new Date(c.ts).toLocaleTimeString()}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="min-w-0 flex-1 overflow-auto bg-[#0d1117] font-mono text-[12px] leading-[1.55]">
        {picked ? (
          <>
            <div className="sticky top-0 border-b border-white/10 bg-[#161b22] px-3 py-1.5 text-[11px] text-white/60">
              {OP[picked.op]} {rel(picked.path)} · {new Date(picked.ts).toLocaleString()}
            </div>
            {picked.hunks.length ? (
              picked.hunks.map((h, i) => <Hunk first={h.line ?? 1} key={i} newText={h.new} oldText={h.old} whole={picked.op !== "edited"} />)
            ) : (
              <p className="p-4 font-sans text-sm text-white/50">{picked.truncated ? "This file is too large (or not text) to show its contents." : "A script wrote this file, so there is no before and after to compare. Open Live view to see it."}</p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Hunk({ oldText, newText, first, whole }: { oldText: string; newText: string; first: number; whole: boolean }) {
  const rows = React.useMemo(() => foldDiff(lineDiff(oldText, newText), 3), [oldText, newText]);
  return (
    <div className="border-b border-white/10 py-1">
      {rows.slice(0, 1500).map((l, i) =>
        l === null ? (
          <div className="bg-[#161b22] px-3 py-0.5 text-[11px] text-white/40" key={i}>⋯</div>
        ) : (
          <div className={cn("flex whitespace-pre", l.kind === "add" && "bg-[#2ea043]/15", l.kind === "remove" && "bg-[#f85149]/15")} key={i}>
            <span className="w-12 shrink-0 select-none pr-2 text-right text-white/25">{(whole ? 0 : first - 1) + l.n}</span>
            <span className={cn("w-4 shrink-0 select-none", l.kind === "add" ? "text-[#3fb950]" : l.kind === "remove" ? "text-[#f85149]" : "text-transparent")}>{l.kind === "add" ? "+" : l.kind === "remove" ? "−" : " "}</span>
            <span className={cn("pr-4", l.kind === "add" ? "text-[#aff5b4]" : l.kind === "remove" ? "text-[#ffdcd7]" : "text-white/80")}>{l.text || " "}</span>
          </div>
        ),
      )}
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

/** The agent's model open in the app's 3D editor: a .model.json as itself, a
 *  .glb/.obj/.stl as an imported object. A new version reopens it. */
function LiveModelEditor({ path, mtime }: { path: string; mtime: number }) {
  const [file, setFile] = React.useState<ModelFile | null>(null);
  const firstPath = React.useRef<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    const name = path.split(String.fromCharCode(92)).join("/").split("/").pop() ?? "Model";
    if (/\.model\.json$/i.test(path)) {
      fetch(`${convertFileSrc(path)}?v=${mtime}`)
        .then((r) => r.json())
        .then((j) => alive && setFile(parseModel(j)))
        .catch(() => undefined);
    } else {
      const base = blankModel();
      setFile({
        ...base,
        objects: [
          {
            id: "live",
            name,
            kind: "import",
            visible: true,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            // A new URL per version, so the editor loads the new file.
            src: `${convertFileSrc(path)}?v=${mtime}`,
          },
        ],
      });
    }
    return () => {
      alive = false;
    };
  }, [path, mtime]);
  // The first version opens the editor; later ones are applied in place.
  const first = React.useRef<ModelFile | null>(null);
  if (file && (!first.current || firstPath.current !== path)) {
    first.current = file;
    firstPath.current = path;
  }
  if (!file || !first.current) return null;
  const title = path.split(String.fromCharCode(92)).join("/").split("/").pop() ?? "Model";
  return (
    <div className="h-full overflow-hidden [&>div]:!h-full [&>div]:!min-h-0 [&>div]:!rounded-none [&>div]:!border-0">
      <React.Suspense fallback={null}>
        <ModelEditor file={first.current} follow={file} key={path} title={title} />
      </React.Suspense>
    </div>
  );
}

/**
 * Code being written, shown like the app's Code tool: the file with line
 * numbers, the lines the agent changed last highlighted and kept in view.
 */
function CodeStage({ src, path, changesFile, changesAt }: { src: string; path: string; changesFile?: string; changesAt?: number }) {
  const [text, setText] = React.useState<string | null>(null);
  const [mark, setMark] = React.useState<{ from: number; to: number } | null>(null);
  const markRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let alive = true;
    fetch(src)
      .then((r) => r.text())
      .then((t) => alive && setText(t))
      .catch(() => alive && setText(""));
    return () => {
      alive = false;
    };
  }, [src]);
  // Where the last change to this file landed, from the agent's change log.
  React.useEffect(() => {
    if (!changesFile) return;
    let alive = true;
    const target = path.replace(/\\/g, "/").toLowerCase();
    fetch(`${convertFileSrc(changesFile)}?v=${changesAt ?? 0}`)
      .then((r) => r.text())
      .then((t) => {
        const rows = t.split("\n");
        for (let i = rows.length - 1; i >= 0; i--) {
          try {
            const c = JSON.parse(rows[i] ?? "") as { path?: string; hunks?: { line?: number; new?: string }[] };
            if (c.path?.replace(/\\/g, "/").toLowerCase() !== target) continue;
            const h = c.hunks?.find((x) => typeof x.line === "number");
            if (h?.line && alive) setMark({ from: h.line, to: h.line + Math.max(1, (h.new ?? "").split("\n").length) - 1 });
            return;
          } catch {
            /* not a change line */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [changesFile, changesAt, path]);
  React.useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [mark, text]);
  const name = path.replace(/\\/g, "/").split("/").pop();
  const lines = (text ?? "").split("\n");
  return (
    <div className="flex h-full flex-col bg-[#0d1117] font-mono text-[12.5px] text-[#c9d1d9]">
      <div className="flex h-9 shrink-0 items-end border-b border-[#30363d] bg-[#010409] px-2">
        <span className="rounded-t-md border border-b-0 border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-[12px] text-[#e6edf3]">{name}</span>
        {mark ? <span className="ml-auto pb-2 pr-2 text-[11px] text-[#8b949e]">last change: lines {mark.from}–{mark.to}</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2">
        {text === null ? null : lines.map((line, i) => {
          const n = i + 1;
          const hit = mark && n >= mark.from && n <= mark.to;
          return (
            <div className={cn("flex", hit && "bg-[#2ea04326]")} key={n} ref={hit && n === mark?.from ? markRef : undefined}>
              <span className={cn("w-14 shrink-0 select-none pr-4 text-right", hit ? "text-[#3fb950]" : "text-[#6e7681]")}>{n}</span>
              <span className="whitespace-pre pr-6">{line || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
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
