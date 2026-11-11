import * as React from "react";
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  FileCode2,
  FilePlus2,
  FileSearch,
  Globe,
  ListTodo,
  Loader2,
  Pencil,
  Search,
  ShieldQuestion,
  SquareTerminal,
  Wrench,
} from "lucide-react";

import type { FileEditDiff } from "@/features/agents/ui/agentSessionFileEditDiff";
import { buildCompactToolSummary } from "@/features/agents/ui/agentSessionToolSummary";
import { cn } from "@/shared/lib/cn";

import { relPath, type ToolItem } from "./codeSession";

type Look = { icon: typeof Wrench; verb: string; tint: string };

function lookOf(item: ToolItem, kind: string): Look {
  const n = item.toolName.toLowerCase();
  if (kind === "file-edit") return /write|create/.test(n) ? { icon: FilePlus2, verb: "Write", tint: "#3fb950" } : { icon: Pencil, verb: "Edit", tint: "#d29922" };
  if (kind === "file-read" || kind === "skill-read") return { icon: FileCode2, verb: "Read", tint: "#58a6ff" };
  if (kind === "shell") return { icon: SquareTerminal, verb: "Run", tint: "#bc8cff" };
  if (/grep|search(?!.*web)|find/.test(n)) return { icon: Search, verb: "Search", tint: "#58a6ff" };
  if (/glob|ls\b|list/.test(n)) return { icon: FileSearch, verb: "Find files", tint: "#58a6ff" };
  if (/todo/.test(n)) return { icon: ListTodo, verb: "Plan", tint: "#e3b341" };
  if (/web|fetch|http/.test(n)) return { icon: Globe, verb: /search/.test(n) ? "Web search" : "Fetch", tint: "#39c5cf" };
  if (/task|agent/.test(n)) return { icon: Bot, verb: "Sub-agent", tint: "#ff7b72" };
  if (kind === "permission") return { icon: ShieldQuestion, verb: "Permission", tint: "#d29922" };
  return { icon: Wrench, verb: item.title || item.toolName, tint: "#8b949e" };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One tool call, drawn as the Code app's own card. */
export function CodeToolCard({ item, root }: { item: ToolItem; root: string }) {
  const summary = React.useMemo(() => buildCompactToolSummary(item), [item]);
  const kind = summary.kind;
  const look = lookOf(item, kind);
  const running = item.status === "executing" || item.status === "pending";
  const failed = item.isError || item.status === "failed";
  const defaultOpen = kind === "file-edit" || kind === "shell" || /todo/i.test(item.toolName);
  const [open, setOpen] = React.useState(defaultOpen);
  const a = item.args ?? {};
  const target =
    summary.fileEditDiff?.path ??
    str(a.file_path) ??
    "";
  const object =
    kind === "shell"
      ? (summary.shellContent ?? str(a.command))
      : target
        ? relPath(target, root)
        : str(a.pattern) || str(a.query) || str(a.url) || str(a.description) || summary.preview || summary.label;
  const stats = summary.fileEditDiff ? { add: summary.fileEditDiff.additions, del: summary.fileEditDiff.deletions } : null;
  const Icon = look.icon;
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-[#161b22]", failed ? "border-[#f85149]/50" : "border-[#30363d]")} data-testid="code-tool">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-white/[0.03]" onClick={() => setOpen((v) => !v)} type="button">
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-[#6e7681] transition", open && "rotate-90")} />
        <Icon className="h-4 w-4 shrink-0" style={{ color: look.tint }} />
        <span className="shrink-0 font-semibold text-[#e6edf3]">{look.verb}</span>
        <span className={cn("min-w-0 flex-1 truncate text-[#8b949e]", kind === "shell" && "font-mono text-[12px]")}>{object}</span>
        {stats ? (
          <span className="shrink-0 font-mono text-[11px]">
            <span className="text-[#3fb950]">+{stats.add}</span> <span className="text-[#f85149]">−{stats.del}</span>
          </span>
        ) : null}
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#8b949e]" />
        ) : failed ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[#f85149]" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-[#3fb950]" />
        )}
      </button>
      {open ? <CardBody item={item} kind={kind} root={root} summary={summary} /> : null}
    </div>
  );
}

function CardBody({ item, kind, summary, root }: { item: ToolItem; kind: string; summary: ReturnType<typeof buildCompactToolSummary>; root: string }) {
  const a = item.args ?? {};
  if (summary.fileEditDiff && !item.isError) return <DiffView diff={summary.fileEditDiff} root={root} />;
  if (kind === "shell") return <Terminal command={summary.shellContent ?? str(a.command)} failed={item.isError} output={item.result} />;
  if (/todo/i.test(item.toolName) && Array.isArray(a.todos)) return <Todos todos={a.todos as { content?: string; status?: string }[]} />;
  if (summary.fileReadContent && !item.isError) {
    const lines = summary.fileReadContent.lines.slice(0, 40);
    return (
      <Code>
        {lines.map((l, i) => (
          <Line key={i} text={l.text} />
        ))}
        {summary.fileReadContent.lines.length > 40 ? <div className="px-3 py-1 text-[11px] text-[#6e7681]">… {summary.fileReadContent.lines.length - 40} more lines</div> : null}
      </Code>
    );
  }
  const result = item.result?.trim();
  return (
    <div className="space-y-2 border-t border-[#30363d] px-3 py-2">
      {Object.keys(a).length ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[#0d1117] p-2 font-mono text-[11.5px] text-[#8b949e]">{JSON.stringify(a, null, 2)}</pre> : null}
      {result ? <pre className={cn("max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[#0d1117] p-2 font-mono text-[11.5px]", item.isError ? "text-[#ffa198]" : "text-[#c9d1d9]")}>{result.slice(0, 20000)}</pre> : null}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <div className="max-h-96 overflow-auto border-t border-[#30363d] bg-[#0d1117] py-1 font-mono text-[12px] leading-[1.55]">{children}</div>;
}

function Line({ text, kind = "context", n }: { text: string; kind?: string; n?: number }) {
  return (
    <div className={cn("flex whitespace-pre", kind === "add" && "bg-[#2ea043]/15", kind === "remove" && "bg-[#f85149]/15")}>
      <span className="w-10 shrink-0 select-none pr-2 text-right text-[#484f58]">{n ?? ""}</span>
      <span className={cn("w-4 shrink-0 select-none", kind === "add" ? "text-[#3fb950]" : kind === "remove" ? "text-[#f85149]" : "text-transparent")}>
        {kind === "add" ? "+" : kind === "remove" ? "−" : " "}
      </span>
      <span className={cn("pr-4", kind === "add" ? "text-[#aff5b4]" : kind === "remove" ? "text-[#ffdcd7]" : "text-[#c9d1d9]")}>{text || " "}</span>
    </div>
  );
}

/** A diff: changed lines with a little context; long unchanged runs fold. */
export function DiffView({ diff, root, max = 400 }: { diff: FileEditDiff; root: string; max?: number }) {
  const lines = diff.lines.filter((l) => l.kind !== "meta");
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.kind === "add" || l.kind === "remove") for (let k = i - 3; k <= i + 3; k++) keep.add(k);
  });
  const rows: React.ReactNode[] = [];
  let skipped = 0;
  let oldN = 1;
  let newN = 1;
  lines.slice(0, max).forEach((l, i) => {
    const n = l.kind === "remove" ? oldN : newN;
    if (l.kind !== "add") oldN++;
    if (l.kind !== "remove") newN++;
    if (!keep.has(i) && keep.size) {
      skipped++;
      return;
    }
    if (skipped) {
      rows.push(<div className="bg-[#161b22] px-3 py-0.5 text-[11px] text-[#6e7681]" key={`s${i}`}>⋯ {skipped} unchanged lines</div>);
      skipped = 0;
    }
    rows.push(<Line key={i} kind={l.kind} n={n} text={l.text} />);
  });
  return (
    <Code>
      <div className="px-3 pb-1 text-[11px] text-[#6e7681]">{relPath(diff.path, root)}</div>
      {rows}
      {lines.length > max ? <div className="px-3 py-1 text-[11px] text-[#6e7681]">… diff truncated ({lines.length - max} more lines)</div> : null}
    </Code>
  );
}

function Terminal({ command, output, failed }: { command: string; output: string; failed: boolean }) {
  const text = (output ?? "").trim();
  return (
    <div className="max-h-96 overflow-auto border-t border-[#30363d] bg-[#010409] p-3 font-mono text-[12px] leading-relaxed">
      <div className="whitespace-pre-wrap text-[#e6edf3]">
        <span className="select-none text-[#3fb950]">$ </span>
        {command}
      </div>
      {text ? <div className={cn("mt-1 whitespace-pre-wrap", failed ? "text-[#ffa198]" : "text-[#8b949e]")}>{text.slice(-20000)}</div> : null}
    </div>
  );
}

function Todos({ todos }: { todos: { content?: string; status?: string }[] }) {
  return (
    <ul className="space-y-1 border-t border-[#30363d] px-3 py-2 text-[13px]">
      {todos.map((t, i) => (
        <li className="flex items-start gap-2" key={i}>
          <span
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              t.status === "completed" ? "border-[#3fb950] bg-[#3fb950] text-[#0d1117]" : t.status === "in_progress" ? "border-[#d29922]" : "border-[#484f58]",
            )}
          >
            {t.status === "completed" ? <Check className="h-3 w-3" /> : t.status === "in_progress" ? <span className="h-1.5 w-1.5 rounded-full bg-[#d29922]" /> : null}
          </span>
          <span className={cn(t.status === "completed" ? "text-[#6e7681] line-through" : t.status === "in_progress" ? "text-[#e6edf3]" : "text-[#c9d1d9]")}>{t.content}</span>
        </li>
      ))}
    </ul>
  );
}
