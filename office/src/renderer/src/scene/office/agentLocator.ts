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

/** A desk's computer was clicked: the agent who sits there, or null for a
 *  free desk (Anything opens the agent's settings, or the hire form). */
const deskListeners = new Set<(agentId: string | null) => void>();

export function onDeskClick(listener: (agentId: string | null) => void): () => void {
  deskListeners.add(listener);
  return () => deskListeners.delete(listener);
}

export function emitDeskClick(agentId: string | null): void {
  for (const listener of deskListeners) listener(agentId);
}

/** A prop on the floor was clicked (e.g. 'printer': Anything opens the
 *  export dialog for the shared files). */
const propListeners = new Set<(prop: string) => void>();

export function onPropClick(listener: (prop: string) => void): () => void {
  propListeners.add(listener);
  return () => propListeners.delete(listener);
}

export function emitPropClick(prop: string): void {
  for (const listener of propListeners) listener(prop);
}
