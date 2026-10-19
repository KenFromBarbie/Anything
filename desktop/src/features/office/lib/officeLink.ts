import * as React from "react";

/**
 * Buzz pages ↔ the Office frame.
 *
 * Commands go to the Office through `sendToOffice`; OfficeScreen connects the
 * sender once the Office has loaded and queued commands are delivered then
 * (opening "New agent" from a channel can start the Office). The Office reports
 * the selected agent's sections back (Michael's Command Center or a worker's
 * panel), which the Agents page renders as Buzz's own section navigation.
 * Pages that show the Office's data in Buzz's own UI call its API
 * (`callOffice`) and read its agents (`useOfficeAgents`).
 */
export type OfficeCommand =
  | { type: "panel-tab"; tab: string }
  | { type: "add-agent" }
  | { type: "panel-state-request" }
  | { type: "state-request" }
  | { type: "api"; id: number; op: string; args: Record<string, unknown> };

let sender: ((command: OfficeCommand) => void) | null = null;
const queued: OfficeCommand[] = [];

export function sendToOffice(command: OfficeCommand): void {
  if (sender) sender(command);
  else queued.push(command);
}

/** Called by OfficeScreen when the Office is ready; returns the disconnect. */
export function connectOffice(send: (command: OfficeCommand) => void) {
  sender = send;
  for (const command of queued.splice(0)) send(command);
  return () => {
    if (sender === send) sender = null;
  };
}

export type OfficeSection = { key: string; label: string };
export type OfficePanelState = {
  /** The selected agent's sections: Michael's Command Center, or a worker's
   *  panel (kept from the last report while no agent is selected). */
  sections: OfficeSection[];
  /** The open section, or null while no agent is selected. */
  section: string | null;
  /** Whose sections they are. */
  agentName: string | null;
};

let panel: OfficePanelState = { sections: [], section: null, agentName: null };
const subscribers = new Set<() => void>();

export function setOfficePanelState(reported: {
  tabs?: OfficeSection[];
  tab?: string | null;
  agentName?: string | null;
}): void {
  const fresh = reported.tabs && reported.tabs.length > 0;
  panel = {
    sections: fresh ? (reported.tabs ?? []) : panel.sections,
    section: reported.tab ?? null,
    agentName: fresh ? (reported.agentName ?? null) : panel.agentName,
  };
  for (const notify of subscribers) notify();
}

export function useOfficePanelState(): OfficePanelState {
  return React.useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => panel,
    () => panel,
  );
}

/** Open a section of the selected agent's panel (shown at once; the Office confirms). */
export function openOfficeSection(key: string): void {
  setOfficePanelState({
    tabs: panel.sections,
    tab: key,
    agentName: panel.agentName,
  });
  sendToOffice({ type: "panel-tab", tab: key });
}

// ─── The Office's API (host/buzzApi in the office runtime) ──────────────────

const CALL_TIMEOUT_MS = 30_000;
let nextCallId = 1;
const pendingCalls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

/** Call one of the Office's operations (tasks.*, dispatch, agents.*). Waits for
 *  the Office to be up if it isn't yet. */
export function callOffice<T = unknown>(
  op: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const id = nextCallId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error("The Office didn't answer."));
    }, CALL_TIMEOUT_MS);
    pendingCalls.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    sendToOffice({ type: "api", id, op, args });
  });
}

/** OfficeScreen hands each `api-result` here. */
export function settleOfficeCall(result: {
  id?: unknown;
  ok?: unknown;
  value?: unknown;
  error?: unknown;
}): void {
  const call =
    typeof result.id === "number" ? pendingCalls.get(result.id) : undefined;
  if (!call) return;
  pendingCalls.delete(result.id as number);
  if (result.ok) call.resolve(result.value);
  else call.reject(new Error(String(result.error ?? "The Office refused.")));
}

/** One of the Office's agents, as its snapshot reports it. */
export type OfficeAgent = {
  id: string;
  name: string;
  isGod: boolean;
  status: string;
  action: string;
  description: string;
  accent: string;
  character: string;
  provider: string;
  model: string | null;
  progress: number;
  hasTerminal: boolean;
  cwd: string;
  contextTokens: number | null;
  contextLimit: number | null;
  /** The worker's project ("hive" for Michael). */
  project: string;
  /** Taken aside for a 1:1: Michael doesn't hand them work. */
  onHold: boolean;
  /** Messages waiting to be typed into the agent's terminal. */
  queue: { id: string; text: string; ts: number }[];
  toolCalls: number;
};

export type OfficeAgentsState = {
  agents: OfficeAgent[];
  selectedId: string | null;
  /** False until the Office has reported once. */
  loaded: boolean;
};

let agentsState: OfficeAgentsState = {
  agents: [],
  selectedId: null,
  loaded: false,
};
const agentSubscribers = new Set<() => void>();

/** OfficeScreen hands each `state` snapshot here. */
export function setOfficeAgentsState(snapshot: {
  agents?: unknown;
  selectedId?: unknown;
}): void {
  agentsState = {
    agents: Array.isArray(snapshot.agents)
      ? (snapshot.agents as OfficeAgent[])
      : [],
    selectedId:
      typeof snapshot.selectedId === "string" ? snapshot.selectedId : null,
    loaded: true,
  };
  for (const notify of agentSubscribers) notify();
}

export function useOfficeAgents(): OfficeAgentsState {
  return React.useSyncExternalStore(
    (notify) => {
      agentSubscribers.add(notify);
      return () => agentSubscribers.delete(notify);
    },
    () => agentsState,
    () => agentsState,
  );
}

/** The latest agents snapshot, outside React. */
export function getOfficeAgents(): OfficeAgentsState {
  return agentsState;
}

// ─── Buzz's Add agent dialog ────────────────────────────────────────────────

let addAgentRequests = 0;
const addAgentSubscribers = new Set<() => void>();

/** Open Buzz's Add agent dialog (on the Agents page). */
export function openAddAgent(): void {
  addAgentRequests++;
  for (const notify of addAgentSubscribers) notify();
}

/** A counter that goes up with each request to open the Add agent dialog. */
export function useAddAgentRequests(): number {
  return React.useSyncExternalStore(
    (notify) => {
      addAgentSubscribers.add(notify);
      return () => addAgentSubscribers.delete(notify);
    },
    () => addAgentRequests,
    () => addAgentRequests,
  );
}

// ─── The Office's full-window overlays ──────────────────────────────────────

let overlayOpen = false;
const overlaySubscribers = new Set<() => void>();

/** OfficeScreen reports while one of the Office's overlays (add or edit an
 *  agent, the IDE, Settings, a fullscreen terminal) is open. */
export function setOfficeOverlay(open: boolean): void {
  if (open === overlayOpen) return;
  overlayOpen = open;
  for (const notify of overlaySubscribers) notify();
}

/** Pages give the Office their whole area while an overlay is open. */
export function useOfficeOverlay(): boolean {
  return React.useSyncExternalStore(
    (notify) => {
      overlaySubscribers.add(notify);
      return () => overlaySubscribers.delete(notify);
    },
    () => overlayOpen,
    () => overlayOpen,
  );
}

/**
 * Forget the Office that was: switching community starts that community's own
 * Office, so nothing from the last one (queued commands, waiting calls, its
 * roster and panel) may carry over.
 */
export function resetOfficeSession(): void {
  sender = null;
  queued.splice(0);
  for (const call of pendingCalls.values()) {
    call.reject(new Error("The Office changed (another community)."));
  }
  pendingCalls.clear();
  panel = { sections: [], section: null, agentName: null };
  for (const notify of subscribers) notify();
  agentsState = { agents: [], selectedId: null, loaded: false };
  for (const notify of agentSubscribers) notify();
  overlayOpen = false;
  for (const notify of overlaySubscribers) notify();
}
