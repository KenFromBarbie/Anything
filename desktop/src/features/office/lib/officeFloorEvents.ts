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
let locate: ((id: string) => void) | null = null;
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

/** The Office frame, able to say where an agent stands. */
export function setFloorLocator(request: ((id: string) => void) | null): void {
  locate = request;
}

/** Ask where an agent stands; the answer comes as an "anchor" event. */
export function requestAgentAnchor(id: string): void {
  locate?.(id);
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
