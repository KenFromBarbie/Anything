import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { accentClasses } from "@/features/office/lib/agentAccent";
import { forceLayout } from "@/features/office/lib/forceLayout";
import {
  callOffice,
  openOfficeSection,
} from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
import { Switch } from "@/shared/ui/switch";

import { openMemoryFor } from "./MemorySection";
import { Muted, SectionCard } from "./SectionBits";

type GraphNode =
  | {
      kind: "agent";
      id: string;
      label: string;
      accent: string;
      status: string;
      isGod: boolean;
      degree: number;
    }
  | { kind: "topic"; id: string; label: string; weight: number }
  | { kind: "pseudo"; id: "broadcast" | "human"; label: string };
type GraphEdge = {
  id: string;
  kind: "message" | "topic";
  source: string;
  target: string;
  weight: number;
  lastAct?: string;
  lastSubject?: string;
};
type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  topicShown: number;
  topicTotal: number;
};

/** Edge colors by the last message's act. */
const ACT_STROKE: Record<string, string> = {
  request: "stroke-sky-400",
  query: "stroke-violet-400",
  propose: "stroke-amber-400",
  agree: "stroke-emerald-400",
  done: "stroke-emerald-400",
  refuse: "stroke-rose-400",
};
const LEGEND: [string, string][] = [
  ["request", "bg-sky-400"],
  ["query", "bg-violet-400"],
  ["propose", "bg-amber-400"],
  ["agree / done", "bg-emerald-400"],
  ["refuse", "bg-rose-400"],
  ["inform", "bg-muted-foreground/50"],
];

function radius(node: GraphNode): number {
  if (node.kind === "agent") {
    return (node.isGod ? 18 : 13) + Math.min(node.degree, 10) * 0.6;
  }
  if (node.kind === "topic") return 6 + Math.min(node.weight, 6) * 0.8;
  return 10;
}

/** Who talks to whom on the floor (and, optionally, what they remember). */
export function GraphSection() {
  const [topics, setTopics] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ w: 800, h: 480 });

  React.useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const graph = useQuery({
    queryKey: ["office", "graph", topics],
    queryFn: () => callOffice<GraphData>("graph.data", { topics }),
    refetchInterval: 5_000,
  });
  const data = graph.data;
  const structure = data
    ? `${data.nodes.map((n) => n.id).join(",")}|${data.edges.map((e) => e.id).join(",")}`
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-layout only when the structure or size changes
  const layout = React.useMemo(() => {
    if (!data) return new Map<string, { x: number; y: number }>();
    return forceLayout(
      data.nodes.map((n) => ({
        id: n.id,
        gravityBias:
          n.kind === "topic"
            ? 0.6
            : n.kind === "pseudo"
              ? 1.4
              : n.isGod
                ? 2.4
                : 1,
      })),
      data.edges.map((e) => ({
        source: e.source,
        target: e.target,
        strength:
          e.kind === "topic" ? 0.35 : 0.7 + Math.min(e.weight, 5) * 0.06,
      })),
      { width: size.w, height: size.h },
    );
  }, [structure, size.w, size.h]);

  const hovered = data?.nodes.find((n) => n.id === hover);
  const hoverEdges = data?.edges.filter(
    (e) => e.kind === "message" && (e.source === hover || e.target === hover),
  );

  return (
    <SectionCard
      action={
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor="graph-topics"
        >
          <Switch
            checked={topics}
            id="graph-topics"
            onCheckedChange={setTopics}
          />
          Topics from memory
        </label>
      }
      description="Agents, who messages whom (thicker = more), colored by the last kind of message. Click an agent to open its memory."
      testId="section-graph"
      title="Graph"
    >
      <div
        className="relative h-[min(60vh,32rem)] min-h-72 overflow-hidden rounded-xl border border-border/60 bg-muted/20"
        ref={wrapRef}
      >
        {!data ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Drawing the floor…
          </div>
        ) : data.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Muted>No agents on the floor yet.</Muted>
          </div>
        ) : (
          <svg
            aria-label="Agent message graph"
            className="h-full w-full"
            height={size.h}
            role="img"
            width={size.w}
          >
            {data.edges.map((edge) => {
              const a = layout.get(edge.source);
              const b = layout.get(edge.target);
              if (!a || !b) return null;
              const active =
                hover && (edge.source === hover || edge.target === hover);
              return (
                <line
                  className={cn(
                    edge.kind === "topic"
                      ? "stroke-muted-foreground/40"
                      : (ACT_STROKE[edge.lastAct ?? ""] ??
                          "stroke-muted-foreground/50"),
                    hover && !active && "opacity-25",
                  )}
                  key={edge.id}
                  strokeDasharray={edge.kind === "topic" ? "3 3" : undefined}
                  strokeLinecap="round"
                  strokeWidth={
                    edge.kind === "topic"
                      ? 1
                      : 1.5 + Math.min(edge.weight, 8) * 0.6
                  }
                  x1={a.x}
                  x2={b.x}
                  y1={a.y}
                  y2={b.y}
                >
                  {edge.lastSubject ? <title>{edge.lastSubject}</title> : null}
                </line>
              );
            })}
            {data.nodes.map((node) => {
              const p = layout.get(node.id);
              if (!p) return null;
              const r = radius(node);
              const dim =
                hover &&
                hover !== node.id &&
                !hoverEdges?.some(
                  (e) => e.source === node.id || e.target === node.id,
                );
              const clickable = node.kind === "agent";
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: SVG nodes; agents are also reachable from the cards above
                <g
                  className={cn(
                    "transition-opacity",
                    dim && "opacity-30",
                    clickable && "cursor-pointer",
                  )}
                  key={node.id}
                  onClick={() => {
                    if (!clickable) return;
                    openMemoryFor(node.id);
                    openOfficeSection("memory");
                  }}
                  onMouseEnter={() => setHover(node.id)}
                  onMouseLeave={() => setHover(null)}
                  transform={`translate(${p.x} ${p.y})`}
                >
                  {node.kind === "agent" ? (
                    <>
                      <circle
                        className={cn(
                          "stroke-background",
                          accentClasses(node.accent).fill,
                        )}
                        r={r}
                        strokeWidth={3}
                      />
                      <text
                        className="fill-white text-xs font-semibold"
                        dominantBaseline="central"
                        textAnchor="middle"
                      >
                        {node.label.charAt(0).toUpperCase()}
                      </text>
                    </>
                  ) : node.kind === "topic" ? (
                    <circle className="fill-muted-foreground/30" r={r} />
                  ) : (
                    <circle
                      className="fill-background stroke-muted-foreground"
                      r={r}
                      strokeDasharray="2 2"
                      strokeWidth={1.5}
                    />
                  )}
                  <text
                    // A halo in the background color keeps labels readable over edges.
                    paintOrder="stroke"
                    strokeLinejoin="round"
                    strokeWidth={4}
                    className={cn(
                      "fill-foreground stroke-background",
                      node.kind === "topic"
                        ? "text-[10px] fill-muted-foreground"
                        : "text-xs",
                    )}
                    textAnchor="middle"
                    y={r + 14}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hovered?.kind === "agent" && hoverEdges ? (
          <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-xl border border-border/70 bg-background/95 px-3 py-2 text-xs shadow-sm">
            <p className="font-medium">{hovered.label}</p>
            <p className="text-muted-foreground">
              {hovered.status} · {hoverEdges.length} conversation
              {hoverEdges.length === 1 ? "" : "s"}
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map(([label, swatch]) => (
          <span className="inline-flex items-center gap-1.5" key={label}>
            <span className={cn("h-1 w-4 rounded-full", swatch)} />
            {label}
          </span>
        ))}
        {topics && data ? (
          <span>
            Topics: {data.topicShown} of {data.topicTotal}
          </span>
        ) : null}
      </div>
    </SectionCard>
  );
}
