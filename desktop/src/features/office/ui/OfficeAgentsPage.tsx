import * as React from "react";
import {
  Activity,
  Bell,
  Brain,
  Clock,
  GitBranch,
  History,
  LayoutDashboard,
  ListChecks,
  Loader2,
  type LucideIcon,
  MessageCircleQuestion,
  MessageSquare,
  MonitorDot,
  Network,
  Plus,
  Sparkles,
  SquareTerminal,
  Users,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";

import { setOfficeAnchor } from "@/features/office/lib/officeAnchor";
import {
  callOffice,
  openOfficeSection,
  sendToOffice,
  useAddAgentRequests,
  useOfficeAgents,
  useOfficeOverlay,
  useOfficePanelState,
} from "@/features/office/lib/officeLink";
import { useShowOfficePart } from "@/features/office/lib/officeView";
import { startOffice } from "@/features/office/ui/OfficeHost";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";

import { AgentCards } from "./agents/AgentCards";
import { AgentFormDialog } from "./agents/AgentFormDialog";
import { AgentHeader } from "./agents/AgentHeader";
import { AgentOverview } from "./agents/AgentOverview";
import { FloorMonitor } from "./agents/FloorMonitor";
import { QueueComposer } from "./agents/QueueComposer";
import { ActivitySection } from "./sections/ActivitySection";
import { GraphSection } from "./sections/GraphSection";
import { MemorySection } from "./sections/MemorySection";
import { ModelsBudgetsSection } from "./sections/ModelsBudgetsSection";
import { SkillsSection } from "./sections/SkillsSection";
import { WorkersSection } from "./sections/WorkersSection";

/** Michael's panel, in Buzz's own UI: his terminal, then his sections
 *  grouped three to a tab (Triggers are the Automations page now). */
type GodTab = "terminal" | "team" | "knowledge" | "insights";
const GOD_TABS: { key: GodTab; label: string; icon: LucideIcon }[] = [
  { key: "terminal", label: "Terminal", icon: SquareTerminal },
  { key: "team", label: "Team & models", icon: Users },
  { key: "knowledge", label: "Memory & skills", icon: Brain },
  { key: "insights", label: "Graph, activity & workers", icon: Network },
];
const GOD_TAB_PARTS: Record<
  Exclude<GodTab, "terminal" | "team">,
  (() => React.ReactElement)[]
> = {
  knowledge: [MemorySection, SkillsSection],
  insights: [GraphSection, ActivitySection, WorkersSection],
};

/** Buzz icons for the panels' sections (keys are the Office's): Michael's
 *  Command Center, then a worker's panel. */
const SECTION_ICONS: Record<string, LucideIcon> = {
  terminal: SquareTerminal,
  floor: MonitorDot,
  tasks: ListChecks,
  human: MessageCircleQuestion,
  triggers: Clock,
  "trigger-history": History,
  memory: Brain,
  graph: Network,
  activity: Bell,
  skills: Sparkles,
  workers: Users,
  git: GitBranch,
  messages: MessageSquare,
  traces: Waypoints,
};

let handledAddRequests = 0;

/**
 * The Agents page, in Buzz's own UI: the floor's agents as cards, then the
 * selected agent — their header and controls, their sections, and in the
 * Terminal section their live terminal with the message queue (and, for
 * Michael, the floor monitor) under it.
 *
 * Only the terminal itself, and the deeper sections (memory, graph, git, …),
 * come from the Office: the live Office frame (OfficeHost, mounted once in
 * AppShell so it keeps running everywhere in Buzz) is pinned over that area.
 * While one of the Office's own overlays is open (adding or editing an agent,
 * the IDE, Settings) it gets the whole page.
 */
export function OfficeAgentsPage() {
  useShowOfficePart("agents");
  // The page shows the Office's agents, so it needs the Office running (and a
  // fresh snapshot of them, in case the last one is stale).
  React.useEffect(() => {
    startOffice();
    sendToOffice({ type: "state-request" });
  }, []);
  const { agents, selectedId, loaded } = useOfficeAgents();
  const { sections, section } = useOfficePanelState();
  const overlay = useOfficeOverlay();
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const michaelName = agents.find((agent) => agent.isGod)?.name ?? "Michael";
  // Michael's terminal is always in view; the other agents open on a chat
  // and their setup, with the terminal and the rest one tab away.
  const [workerView, setWorkerView] = React.useState<"overview" | "office">(
    "overview",
  );
  const [viewFor, setViewFor] = React.useState(selectedId);
  if (viewFor !== selectedId) {
    setViewFor(selectedId);
    setWorkerView("overview");
  }
  const showOverview =
    !!selected && !selected.isGod && workerView === "overview";
  const [godTab, setGodTab] = React.useState<GodTab>("terminal");
  const godNative = !!selected?.isGod && godTab !== "terminal";
  const onTerminal = selected?.isGod
    ? godTab === "terminal"
    : !section || section === "terminal";
  const frameRef =
    overlay || showOverview || godNative ? undefined : setOfficeAnchor;
  const openGodTab = (tab: GodTab) => {
    setGodTab(tab);
    if (tab === "terminal") openOfficeSection("terminal");
  };

  const select = (id: string) =>
    void callOffice("agents.select", { id }).catch((error: Error) =>
      toast.error(error.message),
    );
  const [adding, setAdding] = React.useState(false);
  const addAgent = () => setAdding(true);
  // "New Office agent" from a channel asks for the dialog, possibly before
  // this page has mounted.
  const addRequests = useAddAgentRequests();
  React.useEffect(() => {
    if (addRequests > handledAddRequests) {
      handledAddRequests = addRequests;
      setAdding(true);
    }
  }, [addRequests]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="agents-page-content"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 sm:px-6">
        <PageHeader
          action={
            <Button data-testid="agents-add-agent" onClick={addAgent} size="sm">
              <Plus className="h-4 w-4" />
              Add agent
            </Button>
          }
          description={`${michaelName} orchestrates the Office and routes work to the agents on his floor.`}
          title="Agents"
        />

        {!loaded || agents.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/70 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {loaded ? `${michaelName} is clocking in…` : "Opening the Office…"}
          </div>
        ) : (
          <AgentCards
            agents={agents}
            onAdd={addAgent}
            onSelect={select}
            selectedId={selectedId}
          />
        )}

        {selected ? (
          <section
            className="grid gap-4 rounded-2xl border border-border/70 bg-background/40 p-4"
            data-testid="agents-selected"
          >
            <AgentHeader agent={selected} michaelName={michaelName} />
            {selected.isGod ? (
              <nav
                aria-label="Michael's sections"
                className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5"
                data-testid="agents-sections"
              >
                {GOD_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    aria-current={godTab === key ? "page" : undefined}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
                      godTab === key
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    data-testid={`agents-section-${key}`}
                    key={key}
                    onClick={() => openGodTab(key)}
                    type="button"
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </nav>
            ) : sections.length > 0 ? (
              <nav
                aria-label="Agent sections"
                className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5"
                data-testid="agents-sections"
              >
                {!selected.isGod ? (
                  <button
                    aria-current={showOverview ? "page" : undefined}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
                      showOverview
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    data-testid="agents-section-overview"
                    onClick={() => setWorkerView("overview")}
                    type="button"
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    Chat & manage
                  </button>
                ) : null}
                {sections
                  // Trigger history is a tab of Buzz's Triggers section.
                  .filter(({ key }) => key !== "trigger-history")
                  .map(({ key, label }) => {
                    const Icon = SECTION_ICONS[key] ?? Activity;
                    const active = !showOverview && key === section;
                    return (
                      <button
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm capitalize transition-colors",
                          active
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                        data-testid={`agents-section-${key}`}
                        key={key}
                        onClick={() => {
                          setWorkerView("office");
                          openOfficeSection(key);
                        }}
                        type="button"
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    );
                  })}
              </nav>
            ) : null}
            {showOverview ? (
              <AgentOverview agent={selected} />
            ) : selected.isGod && godTab === "team" ? (
              <div className="grid gap-4" data-testid="agents-tab-team">
                <FloorMonitor
                  agents={agents}
                  onSelect={select}
                  selectedId={selectedId}
                />
                <ModelsBudgetsSection />
              </div>
            ) : selected.isGod &&
              (godTab === "knowledge" || godTab === "insights") ? (
              <div className="grid gap-4" data-testid={`agents-tab-${godTab}`}>
                {GOD_TAB_PARTS[godTab].map((Part) => (
                  <Part key={Part.name} />
                ))}
              </div>
            ) : onTerminal ? (
              <>
                {/* See-through: the terminal is translucent over the panel. */}
                <div
                  className="h-[min(60vh,36rem)] min-h-80 overflow-hidden rounded-xl border border-border/70 bg-transparent"
                  data-testid="office-embed"
                  ref={frameRef}
                />
                <QueueComposer agent={selected} />
              </>
            ) : (
              <div
                className="h-[min(75vh,48rem)] min-h-96 overflow-hidden rounded-xl border border-border/70 bg-background"
                data-testid="office-embed"
                ref={frameRef}
              />
            )}
          </section>
        ) : loaded && agents.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Pick an agent to chat with them and manage them.
          </p>
        ) : null}
      </div>

      {overlay ? (
        // The Office's add/edit dialogs, IDE and Settings get the whole page.
        <div
          className="absolute inset-2 z-20 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl"
          data-testid="office-overlay"
          ref={setOfficeAnchor}
        />
      ) : null}
      <AgentFormDialog mode="add" onOpenChange={setAdding} open={adding} />
    </div>
  );
}
