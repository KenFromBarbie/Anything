/**
 * Where an agent stands on screen, and who was just clicked: Anything
 * opens a small chat above the character's head (see host/buzzHost). The
 * floor registers the locator while it's mounted.
 */

export type ScreenPoint = { x: number; y: number };

let locate: ((agentId: string) => ScreenPoint | null) | null = null;
const clickListeners = new Set<(agentId: string) => void>();

export function setAgentLocator(fn: ((agentId: string) => ScreenPoint | null) | null): void {
  locate = fn;
}

/** The top centre of an agent's character, in this window's CSS pixels. */
export function locateAgent(agentId: string): ScreenPoint | null {
  return locate?.(agentId) ?? null;
}

export function onAgentClick(listener: (agentId: string) => void): () => void {
  clickListeners.add(listener);
  return () => clickListeners.delete(listener);
}

export function emitAgentClick(agentId: string): void {
  for (const listener of clickListeners) listener(agentId);
}
