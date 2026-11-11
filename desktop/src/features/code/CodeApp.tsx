import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  Code2,
  FileDiff,
  FolderGit2,
  GitBranch,
  Loader2,
  Plus,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import type { TranscriptItem } from "@/features/agents/ui/agentSessionTypes";
import { useAgentTranscript } from "@/features/agents/ui/useObserverEvents";
import { useChannelsQuery, useCreateChannelMutation } from "@/features/channels/hooks";
import { AddCodebaseDialog } from "@/features/office/ui/Codebases";
import { useCodebases } from "@/features/office/lib/studioStore";
import type { Codebase } from "@/features/office/lib/studioRequests";
import { addChannelMembers } from "@/shared/api/tauri";
import { startManagedAgent, stopManagedAgent } from "@/shared/api/tauriManagedAgents";
import { sendChannelMessage } from "@/shared/api/tauriMessages";
import type { ManagedAgent } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Markdown } from "@/shared/ui/markdown";

import { CodeToolCard, DiffView } from "./CodeToolCard";
import {
  codePrompt,
  codingAgentRank,
  collectChanges,
  displayPrompt,
  isWorking,
  relPath,
  scopeToChannel,
} from "./codeSession";

const AGENT_KEY = "anything.code.agent";
const channelNameFor = (cb: Codebase) => `code-${cb.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || cb.id}`;

function readPref(): string | null {
  try {
    return localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}

/**
 * Code: a coding agent (Claude Code or another harness) working in one of the
 * owner's codebases, like a terminal coding assistant but drawn as our app —
 * the conversation with every tool call as its own card, and every file it
 * changed with the diff. Each codebase has its own conversation (a private
 * channel with the agent).
 */
export function CodeApp({ onClose }: { onClose: () => void }) {
  const codebases = useCodebases();
  const agentsQuery = useManagedAgentsQuery();
  const { data: channels = [] } = useChannelsQuery();
  const createChannel = useCreateChannelMutation();
  const [linking, setLinking] = React.useState(false);
  const [cbId, setCbId] = React.useState<string | null>(null);
  const [agentPk, setAgentPk] = React.useState<string | null>(readPref);
  const [right, setRight] = React.useState<"changes" | "none">("changes");

  const list = codebases.data ?? [];
  const cb = list.find((c) => c.id === cbId) ?? list[0] ?? null;
  const coders = React.useMemo(
    () =>
      (agentsQuery.data ?? [])
        .filter((a) => a.backend.type === "local")
        .sort((a, b) => codingAgentRank(a) - codingAgentRank(b) || a.name.localeCompare(b.name)),
    [agentsQuery.data],
  );
  const agent = coders.find((a) => a.pubkey === agentPk) ?? coders[0] ?? null;
  const channel = cb ? channels.find((c) => c.name === channelNameFor(cb) && !c.archivedAt) : undefined;

  const transcript = useAgentTranscript(!!agent, agent?.pubkey ?? null);
  const items = React.useMemo(() => scopeToChannel(transcript, channel?.id ?? null), [transcript, channel?.id]);
  const working = isWorking(items);
  const changes = React.useMemo(() => collectChanges(items), [items]);

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=dialog]") && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const chooseAgent = (pk: string) => {
    setAgentPk(pk);
    try {
      localStorage.setItem(AGENT_KEY, pk);
    } catch {
      /* fine */
    }
  };

  /** The codebase's conversation channel, made (with the agent in it) on first use. */
  const ensureChannel = async (a: ManagedAgent, c: Codebase): Promise<string> => {
    if (channel) return channel.id;
    const made = await createChannel.mutateAsync({
      name: channelNameFor(c),
      channelType: "stream",
      visibility: "private",
      description: `Code: ${c.name} (${c.path})`,
    });
    await addChannelMembers({ channelId: made.id, pubkeys: [a.pubkey] });
    return made.id;
  };

  const send = async (text: string) => {
    if (!agent || !cb || !text.trim()) return;
    try {
      if (agent.status !== "running" && agent.status !== "deployed") await startManagedAgent(agent.pubkey);
      const id = await ensureChannel(agent, cb);
      const first = !items.some((i) => i.type === "message" && i.role === "user");
      await sendChannelMessage(id, `@${agent.name} ${codePrompt({ name: cb.name, path: cb.path, branch: cb.branch }, text, first)}`, null, undefined, [agent.pubkey]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const view = (
    <div className="dark fixed inset-0 z-[60] flex flex-col bg-[#0d1117] text-[13px] text-[#c9d1d9] [color-scheme:dark]" data-testid="code-app">
      {/* top bar */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[#30363d] bg-[#010409] px-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#5b4fe0]/25 text-[#a5a0ff] ring-1 ring-[#5b4fe0]/60">
          <Code2 className="h-3.5 w-3.5" />
        </span>
        <span className="font-semibold text-[#e6edf3]">Code</span>
        {cb ? (
          <span className="flex items-center gap-1.5 text-[#8b949e]">
            <FolderGit2 className="h-3.5 w-3.5" /> {cb.name}
            {cb.branch ? (
              <span className="flex items-center gap-1 rounded-full bg-[#21262d] px-2 py-0.5 text-[11px]">
                <GitBranch className="h-3 w-3" /> {cb.branch}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="flex-1" />
        <AgentPicker agent={agent} agents={coders} onPick={chooseAgent} />
        <button
          className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px]", right === "changes" ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:bg-[#21262d]")}
          onClick={() => setRight((r) => (r === "changes" ? "none" : "changes"))}
          type="button"
        >
          <FileDiff className="h-3.5 w-3.5" /> Changes {changes.length ? <span className="rounded-full bg-[#30363d] px-1.5 text-[10px]">{changes.length}</span> : null}
        </button>
        <button aria-label="Close Code" className="rounded-md p-1.5 text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]" onClick={onClose} type="button">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* codebases */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-[#30363d] bg-[#010409]">
          <div className="flex items-center px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
            Codebases
            <span className="flex-1" />
            <button aria-label="Link a codebase" className="rounded p-0.5 hover:bg-[#21262d] hover:text-[#e6edf3]" onClick={() => setLinking(true)} type="button">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {list.map((c) => (
              <button
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", c.id === cb?.id ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:bg-[#161b22]")}
                key={c.id}
                onClick={() => setCbId(c.id)}
                type="button"
              >
                <FolderGit2 className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.exists === false ? <span className="text-[10px] text-[#f85149]">missing</span> : null}
              </button>
            ))}
            {!list.length ? (
              <button className="mt-2 w-full rounded-md border border-dashed border-[#30363d] px-3 py-4 text-[12px] text-[#8b949e] hover:border-[#5b4fe0]" onClick={() => setLinking(true)} type="button">
                Link a GitHub repo or a folder to start
              </button>
            ) : null}
          </div>
          {cb ? <div className="truncate border-t border-[#30363d] px-3 py-2 font-mono text-[10.5px] text-[#6e7681]" title={cb.path}>{cb.path}</div> : null}
        </aside>

        {/* conversation */}
        <main className="flex min-w-0 flex-1 flex-col">
          <Conversation agent={agent} cb={cb} items={items} working={working} />
          <Composer
            disabled={!agent || !cb}
            onSend={send}
            onStop={agent ? () => void stopManagedAgent(agent.pubkey).then(() => toast.message(`${agent.name} stopped`)) : undefined}
            placeholder={!agent ? "Set up a coding agent on the Agents page first (Claude Code, Codex, Goose…)" : !cb ? "Link a codebase first" : `Ask ${agent.name} to build, fix or explain something in ${cb.name}…`}
            working={working}
          />
        </main>

        {right === "changes" ? <ChangesPanel changes={changes} root={cb?.path ?? ""} /> : null}
      </div>
      <AddCodebaseDialog onOpenChange={setLinking} open={linking} />
    </div>
  );
  return createPortal(view, document.body);
}

function AgentPicker({ agent, agents, onPick }: { agent: ManagedAgent | null; agents: ManagedAgent[]; onPick: (pk: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button className="flex h-7 items-center gap-1.5 rounded-md border border-[#30363d] px-2.5 text-[12px] text-[#e6edf3] hover:bg-[#21262d]" onClick={() => setOpen((v) => !v)} type="button">
        <Bot className="h-3.5 w-3.5 text-[#a5a0ff]" />
        {agent ? agent.name : "No coding agent"}
        {agent?.model ? <span className="text-[#6e7681]">· {agent.model}</span> : null}
        <span className={cn("h-1.5 w-1.5 rounded-full", agent?.status === "running" || agent?.status === "deployed" ? "bg-[#3fb950]" : "bg-[#6e7681]")} />
        <ChevronDown className="h-3 w-3 text-[#6e7681]" />
      </button>
      {open ? (
        <div className="absolute right-0 top-8 z-10 w-72 rounded-lg border border-[#30363d] bg-[#161b22] p-1 shadow-2xl">
          {agents.length ? (
            agents.map((a) => (
              <button
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[#21262d]", a.pubkey === agent?.pubkey && "bg-[#21262d]")}
                key={a.pubkey}
                onClick={() => {
                  onPick(a.pubkey);
                  setOpen(false);
                }}
                type="button"
              >
                <Bot className="h-3.5 w-3.5 text-[#a5a0ff]" />
                <span className="flex-1 truncate text-[#e6edf3]">{a.name}</span>
                <span className="truncate text-[11px] text-[#6e7681]">{a.agentCommand}</span>
              </button>
            ))
          ) : (
            <p className="p-2 text-[12px] text-[#8b949e]">No agents run on this computer yet. Make one on the Agents page with the Claude Code harness.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Conversation({ items, agent, cb, working }: { items: TranscriptItem[]; agent: ManagedAgent | null; cb: Codebase | null; working: boolean }) {
  const end = React.useRef<HTMLDivElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  React.useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [items.length, working]);
  if (!items.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#5b4fe0]/20 text-[#a5a0ff] ring-1 ring-[#5b4fe0]/50">
          <Code2 className="h-6 w-6" />
        </span>
        <div className="text-[15px] font-semibold text-[#e6edf3]">{cb ? `What should we build in ${cb.name}?` : "Pick or link a codebase"}</div>
        <p className="max-w-md text-[12.5px] text-[#8b949e]">
          {agent ? `${agent.name} reads your code, edits files, runs commands and tests. Every step shows up here, and every change lands in Changes with its diff.` : "Choose a coding agent at the top right."}
        </p>
      </div>
    );
  }
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      ref={box}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-6 py-6">
        {items.map((it) => (
          <Item cb={cb} item={it} key={it.id} />
        ))}
        {working ? (
          <div className="flex items-center gap-2 py-1 text-[12px] text-[#8b949e]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#a5a0ff]" /> {agent?.name ?? "Agent"} is working…
          </div>
        ) : null}
        <div ref={end} />
      </div>
    </div>
  );
}

function Item({ item, cb }: { item: TranscriptItem; cb: Codebase | null }) {
  const [open, setOpen] = React.useState(false);
  if (item.type === "message") {
    if (item.role === "user") {
      return (
        <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#1f2a44] px-4 py-2.5 text-[13.5px] text-[#e6edf3]">
          {displayPrompt(item.text).replace(/^@\S+\s/, "")}
        </div>
      );
    }
    return (
      <div className="prose-invert max-w-none text-[13.5px] leading-relaxed text-[#e6edf3] [&_code]:rounded [&_code]:bg-[#161b22] [&_code]:px-1 [&_pre]:rounded-lg [&_pre]:bg-[#161b22]">
        <Markdown content={item.text} />
      </div>
    );
  }
  if (item.type === "thought") {
    return (
      <button className="flex items-start gap-2 text-left text-[12px] italic text-[#6e7681] hover:text-[#8b949e]" onClick={() => setOpen((v) => !v)} type="button">
        <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className={open ? "whitespace-pre-wrap" : "line-clamp-1"}>{item.text}</span>
      </button>
    );
  }
  if (item.type === "plan") {
    return <div className="whitespace-pre-wrap rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-[12.5px] text-[#c9d1d9]">{item.text}</div>;
  }
  if (item.type === "tool") return <CodeToolCard item={item} root={cb?.path ?? ""} />;
  if (item.type === "lifecycle" && item.renderClass !== "status") {
    return (
      <div className={cn("rounded-lg border px-3 py-2 text-[12.5px]", item.renderClass === "error" ? "border-[#f85149]/50 text-[#ffa198]" : "border-[#d29922]/50 text-[#e3b341]")}>
        <span className="font-semibold">{item.title}</span> {item.text} {item.outcome ? `· ${item.outcome}` : ""}
      </div>
    );
  }
  return null;
}

function Composer({ onSend, onStop, disabled, working, placeholder }: { onSend: (t: string) => Promise<void>; onStop?: () => void; disabled: boolean; working: boolean; placeholder: string }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!text.trim() || disabled || busy) return;
    setBusy(true);
    const t = text;
    setText("");
    await onSend(t);
    setBusy(false);
  };
  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[#30363d] bg-[#161b22] p-2 focus-within:border-[#5b4fe0]">
        <textarea
          className="max-h-60 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] text-[#e6edf3] outline-none placeholder:text-[#6e7681]"
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          rows={Math.min(8, Math.max(1, text.split("\n").length))}
          value={text}
        />
        {working && onStop ? (
          <button aria-label="Stop the agent" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#30363d] text-[#e6edf3] hover:bg-[#484f58]" onClick={onStop} title="Stop the agent" type="button">
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : null}
        <button
          aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#5b4fe0] text-white hover:bg-[#6c61f0] disabled:opacity-40"
          disabled={disabled || busy || !text.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl px-2 text-[11px] text-[#6e7681]">Enter to send · Shift+Enter new line · Esc closes</p>
    </div>
  );
}

function ChangesPanel({ changes, root }: { changes: ReturnType<typeof collectChanges>; root: string }) {
  const [sel, setSel] = React.useState<string | null>(null);
  const picked = changes.find((c) => c.path === sel) ?? changes[0] ?? null;
  const add = changes.reduce((s, c) => s + c.additions, 0);
  const del = changes.reduce((s, c) => s + c.deletions, 0);
  return (
    <aside className="flex w-[30rem] shrink-0 flex-col border-l border-[#30363d] bg-[#010409]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
        Changes
        {changes.length ? (
          <span className="font-mono normal-case">
            {changes.length} file{changes.length === 1 ? "" : "s"} · <span className="text-[#3fb950]">+{add}</span> <span className="text-[#f85149]">−{del}</span>
          </span>
        ) : null}
      </div>
      {!changes.length ? (
        <p className="px-3 text-[12px] text-[#6e7681]">Files the agent edits in this conversation show up here with their diffs.</p>
      ) : (
        <>
          <div className="max-h-56 shrink-0 overflow-y-auto border-b border-[#30363d] px-2 pb-2">
            {changes.map((c) => (
              <button
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]", c.path === picked?.path ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:bg-[#161b22]")}
                key={c.path}
                onClick={() => setSel(c.path)}
                title={c.path}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate font-mono">{relPath(c.path, root)}</span>
                <span className="shrink-0 font-mono text-[11px]">
                  <span className="text-[#3fb950]">+{c.additions}</span> <span className="text-[#f85149]">−{c.deletions}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {picked
              ? [...picked.edits].reverse().map((e) => (
                  <div className="overflow-hidden rounded-lg border border-[#30363d]" key={e.id}>
                    <div className="bg-[#161b22] px-3 py-1 text-[11px] text-[#6e7681]">{new Date(e.at).toLocaleTimeString()}</div>
                    <DiffView diff={e.diff} root={root} />
                  </div>
                ))
              : null}
          </div>
        </>
      )}
    </aside>
  );
}
