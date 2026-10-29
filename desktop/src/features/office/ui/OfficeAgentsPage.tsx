import * as React from "react";
import {
  Activity,
  Bell,
  Bot,
  Brain,
  Clock,
  GitBranch,
  History,
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
import { useOpenAgentDm } from "@/features/office/lib/agentDm";
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

/** The Agents page's tabs, the same whoever is selected: the floor and the
 *  selected agent, every terminal, then the floor-wide sections (Triggers
 *  are the Automations page). */
type PageTab = "agents" | "terminals" | "team" | "knowledge" | "insights";
const PAGE_TABS: { key: PageTab; label: string; icon: LucideIcon }[] = [
  { key: "agents", label: "Agents", icon: Bot },
  { key: "terminals", label: "Terminals", icon: SquareTerminal },
  { key: "team", label: "Team & models", icon: Users },
  { key: "knowledge", label: "Memory & skills", icon: Brain },
  { key: "insights", label: "Graph, activity & workers", icon: Network },
];
const TAB_PARTS: Record<
  "knowledge" | "insights",
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
 * The Agents page, in Buzz's own UI, with one row of tabs: the agents (cards,
 * then the selected one's header, controls and setup; Chat opens their DM,
 * and the menu their git, messages and traces), every terminal, and the
 * floor-wide sections.
 *
 * Only the terminals themselves, and an agent's git, messages and traces,
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
  const { sections } = useOfficePanelState();
  const overlay = useOfficeOverlay();
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const michaelName = agents.find((agent) => agent.isGod)?.name ?? "Michael";
  const chat = useOpenAgentDm();
  const [tab, setTab] = React.useState<PageTab>("agents");
  // In the Agents tab an agent opens on its setup; its Office panels (git,
  // messages, traces, its terminal) are one click away.
  const [agentView, setAgentView] = React.useState<"setup" | "office">("setup");
  const [viewFor, setViewFor] = React.useState(selectedId);
  if (viewFor !== selectedId) {
    setViewFor(selectedId);
    setAgentView("setup");
  }
  // The Office frame is pinned over the page only where an Office panel shows.
  const showsFrame =
    !overlay &&
    !!selected &&
    (tab === "terminals" || (tab === "agents" && agentView === "office"));
  const frameRef = showsFrame ? setOfficeAnchor : undefined;

  const select = (id: string) =>
    void callOffice("agents.select", { id }).catch((error: Error) =>
      toast.error(error.message),
    );
  const openTab = (next: PageTab) => {
    setTab(next);
    if (next === "terminals") openOfficeSection("terminal");
  };
  const showTerminalOf = (id: string) => {
    select(id);
    openOfficeSection("terminal");
  };
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

  const tabButton = (active: boolean) =>
    cn(
      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
      active
        ? "bg-muted font-medium text-foreground"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    );
  const officeEmbed = (terminal: boolean) => (
    // See-through: the terminal is translucent over the panel.
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/70",
        terminal
          ? "h-[min(60vh,36rem)] min-h-80 bg-transparent"
          : "h-[min(75vh,48rem)] min-h-96 bg-background",
      )}
      data-testid="office-embed"
      ref={frameRef}
    />
  );

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

        <nav
          aria-label="Agents"
          // shrink-0: the page is a scrolling column, which would squash a
          // sideways-scrolling row to nothing.
          className="-mx-1 flex shrink-0 items-center gap-1 overflow-x-auto px-1 pb-0.5"
          data-testid="agents-sections"
        >
          {PAGE_TABS.map(({ key, label, icon: Icon }) => (
            <button
              aria-current={tab === key ? "page" : undefined}
              className={tabButton(tab === key)}
              data-testid={`agents-section-${key}`}
              key={key}
              onClick={() => openTab(key)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {!loaded || agents.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/70 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {loaded ? `${michaelName} is clocking in…` : "Opening the Office…"}
          </div>
        ) : tab === "agents" ? (
          <>
            <AgentCards
              agents={agents}
              onAdd={addAgent}
              onSelect={select}
              selectedId={selectedId}
            />
            {selected ? (
              <section
                className="grid gap-4 rounded-2xl border border-border/70 bg-background/40 p-4"
                data-testid="agents-selected"
              >
                <AgentHeader
                  agent={selected}
                  chatPending={chat.pending}
                  michaelName={michaelName}
                  onChat={() => void chat.open(selected)}
                  onOpenPanel={(key) => {
                    setAgentView("office");
                    openOfficeSection(key);
                  }}
                  panels={sections
                    // Their terminal is the Terminals tab; trigger history
                    // the Automations page.
                    .filter(
                      ({ key }) =>
                        key !== "terminal" && key !== "trigger-history",
                    )
                    .map(({ key, label }) => ({
                      key,
                      label,
                      icon: SECTION_ICONS[key] ?? Activity,
                    }))}
                />
                {agentView === "setup" ? (
                  <AgentOverview agent={selected} />
                ) : (
                  <>
                    <button
                      className="justify-self-start text-sm text-muted-foreground hover:text-foreground"
                      data-testid="agent-back-to-setup"
                      onClick={() => setAgentView("setup")}
                      type="button"
                    >
                      ← Setup
                    </button>
                    {officeEmbed(false)}
                  </>
                )}
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick an agent to see and manage them.
              </p>
            )}
          </>
        ) : tab === "terminals" ? (
          <section className="grid gap-3" data-testid="agents-tab-terminals">
            <div
              className="-mx-1 flex flex-wrap items-center gap-1 px-1"
              data-testid="terminal-switcher"
            >
              {agents
                .filter((agent) => agent.hasTerminal)
                .map((agent) => (
                  <button
                    aria-current={agent.id === selectedId ? "true" : undefined}
                    className={tabButton(agent.id === selectedId)}
                    data-testid={`terminal-of-${agent.id}`}
                    key={agent.id}
                    onClick={() => showTerminalOf(agent.id)}
                    type="button"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: agent.accent }}
                    />
                    {agent.name}
                    <span className="text-xs text-muted-foreground">
                      {agent.action || agent.status}
                    </span>
                  </button>
                ))}
            </div>
            {selected?.hasTerminal ? (
              <>
                {officeEmbed(true)}
                <QueueComposer agent={selected} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a terminal above.
              </p>
            )}
          </section>
        ) : tab === "team" ? (
          <div className="grid gap-4" data-testid="agents-tab-team">
            <FloorMonitor
              agents={agents}
              onSelect={select}
              selectedId={selectedId}
            />
            <ModelsBudgetsSection />
          </div>
        ) : (
          <div className="grid gap-4" data-testid={`agents-tab-${tab}`}>
            {TAB_PARTS[tab].map((Part) => (
              <Part key={Part.name} />
            ))}
          </div>
        )}
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
