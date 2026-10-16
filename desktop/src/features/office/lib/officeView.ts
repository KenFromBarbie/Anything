import * as React from "react";

/**
 * Which part of the Office is showing: "agents" (the selected agent's panel —
 * Michael's Command Center — and the agent strip, on the Agents page),
 * "office" (the floor, on the Office page), "tasks" (the task board, on the
 * Tasks page) or "askme" (the agents' questions, on the Ask Me page). The
 * Office is one live frame these pages share; it switches parts in place and
 * keeps the hidden parts running. Each page sets its part when it shows
 * (`useShowOfficePart`).
 */
export type OfficeView = "agents" | "office" | "tasks" | "askme";

let view: OfficeView = "agents";
const subscribers = new Set<() => void>();

export function getOfficeView(): OfficeView {
  return view;
}

export function setOfficeView(next: OfficeView): void {
  if (next === view) return;
  view = next;
  for (const notify of subscribers) notify();
}

export function subscribeOfficeView(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

/** Show `part` of the Office while the calling page is mounted. */
export function useShowOfficePart(part: OfficeView): void {
  React.useLayoutEffect(() => setOfficeView(part), [part]);
}
