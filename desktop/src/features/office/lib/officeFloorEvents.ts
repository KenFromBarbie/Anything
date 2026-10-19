/**
 * Clicks on the Office floor, for the Office page: a character clicked (with
 * where its head is, in window pixels) opens a small chat above it, and the
 * floor's task board opens the tasks window instead of the Tasks page.
 * OfficeScreen feeds these from the Office frame.
 */

export type FloorPoint = { x: number; y: number };
export type FloorAgentEvent = {
  kind: "click" | "anchor";
  id: string;
  at: FloorPoint | null;
};

const agentListeners = new Set<(event: FloorAgentEvent) => void>();
/** Which frame is the Office the page shows: the background floor (its
 *  "mirror", when the floor is the app's background) or the main frame. */
export type FloorSource = "mirror" | "main";
type FloorChannel = {
  locate: (id: string) => void;
  track?: (id: string | null) => void;
};
const channels: Partial<Record<FloorSource, FloorChannel>> = {};
let source: FloorSource = "main";
let tasksHandler: (() => void) | null = null;

export function emitFloorAgent(event: FloorAgentEvent): void {
  for (const listener of agentListeners) listener(event);
}

export function onFloorAgent(
  listener: (event: FloorAgentEvent) => void,
): () => void {
  agentListeners.add(listener);
  return () => agentListeners.delete(listener);
}

/** A frame able to say where an agent stands (and follow one). */
export function setFloorChannel(
  from: FloorSource,
  channel: FloorChannel | null,
): void {
  if (channel) channels[from] = channel;
  else delete channels[from];
}

/** Which frame the Office page is using. */
export function setFloorSource(from: FloorSource): void {
  source = from;
}

/** Ask where an agent stands; the answer comes as an "anchor" event. */
export function requestAgentAnchor(id: string): void {
  channels[source]?.locate(id);
}

/** Have the floor report where an agent stands every frame they move (as
 *  "anchor" events), or stop (null). Falls back to asking now and then. */
export function trackAgent(id: string | null): () => void {
  const channel = channels[source];
  if (channel?.track) {
    channel.track(id);
    return () => channel.track?.(null);
  }
  if (!id || !channel) return () => undefined;
  channel.locate(id);
  const timer = setInterval(() => channel.locate(id), 500);
  return () => clearInterval(timer);
}

/** The Office page, while open, takes the floor's "open the tasks" itself. */
export function setFloorTasksHandler(handler: (() => void) | null): void {
  tasksHandler = handler;
}

/** True when the Office page took it. */
export function openFloorTasks(): boolean {
  if (!tasksHandler) return false;
  tasksHandler();
  return true;
}
