import * as React from "react";
import { createPortal } from "react-dom";
import { ListChecks, MessageSquare, X } from "lucide-react";

import { accentDotClass } from "@/features/office/lib/agentAccent";
import { setOfficeAnchor } from "@/features/office/lib/officeAnchor";
import {
  type OfficeAgent,
  useOfficeAgents,
} from "@/features/office/lib/officeLink";
import { useShowOfficePart } from "@/features/office/lib/officeView";
import { useOfficeTasks } from "@/features/tasks/lib/useTasksData";
import { AgentsBoard } from "@/features/tasks/ui/AgentsBoard";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useSidebar } from "@/shared/ui/sidebar";

import { AgentChat } from "./agents/AgentChat";

/**
 * The Office page: the live floor, filling the window (the sidebar folds away
 * while it's open and comes back on leaving). Click an agent on the floor, or
 * in the strip at the bottom, to chat with them in a drawer; the task board
 * opens in a drawer too.
 *
 * The floor is the same live Office frame the Agents page uses, pinned over
 * this page; the drawers and strip are drawn above it (portaled, since the
 * frame sits above the page's own layer).
 */
export function OfficeFloorPage() {
  useShowOfficePart("office");
  useFoldedSidebar();
  const { agents, selectedId } = useOfficeAgents();
  const [chatId, setChatId] = React.useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = React.useState(false);

  // An agent picked on the floor opens their chat.
  const lastSelected = React.useRef(selectedId);
  React.useEffect(() => {
    if (selectedId && selectedId !== lastSelected.current) {
      setChatId(selectedId);
      setTasksOpen(false);
    }
    lastSelected.current = selectedId;
  }, [selectedId]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setChatId(null);
      setTasksOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chatAgent = agents.find((a) => a.id === chatId) ?? null;

  return (
    <div
      className="relative flex min-h-0 flex-1"
      data-testid="office-page-content"
    >
      <div
        className="absolute inset-0"
        data-testid="office-embed"
        ref={setOfficeAnchor}
      />
      {createPortal(
        <>
          <div className="pointer-events-none fixed right-4 top-14 z-40 flex gap-2">
            <Button
              className="pointer-events-auto shadow-md"
              data-testid="office-open-tasks"
              onClick={() => {
                setTasksOpen((open) => !open);
                setChatId(null);
              }}
              size="sm"
              variant={tasksOpen ? "default" : "outline"}
            >
              <ListChecks />
              Tasks
            </Button>
          </div>
          <AgentStrip
            activeId={chatId}
            agents={agents}
            onPick={(id) => {
              setChatId((current) => (current === id ? null : id));
              setTasksOpen(false);
            }}
          />
          {chatAgent ? (
            <Drawer
              onClose={() => setChatId(null)}
              title={
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      accentDotClass(chatAgent.accent),
                    )}
                  />
                  {chatAgent.name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {chatAgent.action || chatAgent.status}
                  </span>
                </span>
              }
              width="w-[min(440px,calc(100vw-2rem))]"
            >
              <AgentChat agent={chatAgent} key={chatAgent.id} />
            </Drawer>
          ) : null}
          {tasksOpen ? (
            <Drawer
              onClose={() => setTasksOpen(false)}
              title={
                <span className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4" />
                  Tasks
                </span>
              }
              width="w-[min(960px,calc(100vw-2rem))]"
            >
              <OfficeTasks agents={agents} />
            </Drawer>
          ) : null}
        </>,
        document.body,
      )}
    </div>
  );
}

/** Fold the sidebar away while the page is open; put it back on leaving. */
function useFoldedSidebar() {
  const { open, setOpen } = useSidebar();
  const openRef = React.useRef(open);
  openRef.current = open;
  const setOpenRef = React.useRef(setOpen);
  setOpenRef.current = setOpen;
  React.useEffect(() => {
    const wasOpen = openRef.current;
    setOpenRef.current(false);
    return () => setOpenRef.current(wasOpen);
  }, []);
}

function Drawer({
  children,
  onClose,
  title,
  width,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: React.ReactNode;
  width: string;
}) {
  return (
    <aside
      className={cn(
        "fixed bottom-20 right-4 top-24 z-40 flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-2xl backdrop-blur",
        width,
      )}
      data-testid="office-drawer"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        <Button
          aria-label="Close"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

/** The floor's agents, for opening a chat even with an agent already picked. */
function AgentStrip({
  activeId,
  agents,
  onPick,
}: {
  activeId: string | null;
  agents: OfficeAgent[];
  onPick: (id: string) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <nav
      aria-label="Chat with an agent"
      className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-border/70 bg-background/90 p-1 shadow-lg backdrop-blur"
      data-testid="office-agent-strip"
    >
      <MessageSquare className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
      {agents.map((agent) => (
        <button
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
            activeId === agent.id
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted",
          )}
          key={agent.id}
          onClick={() => onPick(agent.id)}
          type="button"
        >
          <span
            className={cn("h-2 w-2 rounded-full", accentDotClass(agent.accent))}
          />
          {agent.name}
        </button>
      ))}
    </nav>
  );
}

function OfficeTasks({ agents }: { agents: OfficeAgent[] }) {
  const { data: tasks = [], isLoading } = useOfficeTasks();
  return (
    <AgentsBoard
      agents={agents}
      loading={isLoading}
      onOpenAskMe={() => {
        window.location.hash = "#/ask-me";
      }}
      tasks={tasks}
    />
  );
}
