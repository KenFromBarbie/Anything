/**
 * Hosting inside Buzz.
 *
 * Buzz shows parts of the Office on its pages: the agents (the selected
 * agent's panel and the strip), the floor, the task board, Ask Me. The renderer
 * stays ONE instance — a second one would run the hive's delivery loop twice —
 * so Buzz says which part to show and everything else stays mounted, hidden:
 * terminals keep their scrollback and timers keep running. Pages that show the
 * Office's data in Buzz's own UI use its API (host/buzzApi).
 *
 * Buzz also sends its theme. It replaces the Office's palette and type through
 * the same `--cth-*` tokens the dark theme swaps, so the Office reads as part of
 * Buzz and follows Buzz's light/dark switch. The pixel-art floor and characters
 * are content, not chrome, and keep their look.
 *
 * Standalone (no Buzz parent), none of this applies: the view is 'all'.
 */
import { useSyncExternalStore } from 'react';
import { appTheme, setAppTheme } from '@/design/theme';
import { notifyThemeChangeAll } from '@/components/terminalPool';
import { setTerminalBackground } from '@/components/PtyTerminalView';
import { useStore } from '@/store/store';
import { SIDEBAR_TABS } from '@/components/SidebarTabs';
import { runBuzzApi, startStatePush, stateNow } from '@/host/buzzApi';
import { locateAgent, onAgentClick } from '@/scene/office/agentLocator';
export { EDIT_AGENT_EVENT } from '@/host/buzzApi';

export type HostView = 'all' | 'agents' | 'office' | 'tasks' | 'askme';

const HOST_VIEWS: HostView[] = ['all', 'agents', 'office', 'tasks', 'askme'];

/** Colors as CSS color strings, resolved by Buzz where the Office sits. */
export interface HostTheme {
  dark: boolean;
  fontFamily?: string;
  colors: {
    background: string;
    foreground: string;
    card: string;
    muted: string;
    mutedForeground: string;
    border: string;
    primary: string;
    primaryForeground: string;
  };
}

export const hostedInBuzz =
  typeof window !== 'undefined' &&
  window.parent !== window &&
  /(^|[#&])sidecarUrl=/.test(window.location.hash);

/** Anything's background frame: draws the floor only, from the state
 *  the main frame broadcasts (see MirrorFloor). */
export const mirrorRole =
  hostedInBuzz && /(^|[#&])role=mirror(&|$)/.test(window.location.hash);

/** What the floor draws, copied from the main frame to the mirror. */
function mirrorSnapshot() {
  const s = useStore.getState();
  return { agents: s.agents, selectedId: s.selectedId, officeTheme: s.officeTheme, meetingAgentIds: s.meetingAgentIds };
}

/** The main frame broadcasts the floor's state for the background mirror:
 *  on change (at most every 150 ms) and every 2 s. */
function startMirrorBroadcast(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = () => {
    timer = null;
    try {
      post({ type: 'mirror', snapshot: mirrorSnapshot() });
    } catch {
      // A value that can't be cloned: the next change or heartbeat retries.
    }
  };
  useStore.subscribe((s, prev) => {
    if (s.agents === prev.agents && s.selectedId === prev.selectedId && s.officeTheme === prev.officeTheme && s.meetingAgentIds === prev.meetingAgentIds) return;
    if (!timer) timer = setTimeout(send, 150);
  });
  setInterval(send, 2000);
  send();
}

function initialView(): HostView {
  if (!hostedInBuzz) return 'all';
  const v = new URLSearchParams(window.location.hash.slice(1)).get('view') as HostView | null;
  return v && HOST_VIEWS.includes(v) ? v : 'agents';
}

let view: HostView = initialView();
const subscribers = new Set<() => void>();

export function useHostView(): HostView {
  return useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    () => view
  );
}

function setView(next: HostView): void {
  if (next === view) return;
  view = next;
  subscribers.forEach((fn) => fn());
}

/** Rounded corners for the shared building blocks, Buzz-style. Panels and
 *  buttons draw their outlines with inset shadows, so a radius is all it takes. */
const HOSTED_CSS = `
:root[data-cth-host='buzz'] [data-cth-panel] { border-radius: 10px; }
:root[data-cth-host='buzz'] [data-cth-panel-title] { border-radius: 10px 10px 0 0; }
:root[data-cth-host='buzz'] [data-cth-button] { border-radius: 6px; }
:root[data-cth-host='buzz'] [data-cth-badge] { border-radius: 999px; }
`;

function applyTheme(theme: HostTheme): void {
  const root = document.documentElement;
  const c = theme.colors;
  const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  const tokens: Record<string, string> = {
    // Surfaces: the ground is Buzz's content background; the cream steps are
    // tints toward its muted surface, the way Buzz layers panes.
    '--cth-cream-50': c.background,
    '--cth-cream-100': mix(c.muted, c.background, 22),
    '--cth-cream-200': mix(c.muted, c.background, 45),
    '--cth-cream-300': c.muted,
    '--cth-paper-100': c.card,
    '--cth-paper-200': mix(c.muted, c.card, 35),
    // Ink ramp: text to borders.
    '--cth-ink-900': c.foreground,
    '--cth-ink-700': mix(c.foreground, c.mutedForeground, 55),
    '--cth-ink-500': c.mutedForeground,
    '--cth-ink-300': c.border,
    '--cth-ink-100': mix(c.border, c.background, 55),
    // The brand accent (selected tabs, the BOSS tag, primary buttons) is a
    // LIGHT surface under dark text in the Office's design, so it becomes a tint
    // of Buzz's primary rather than the primary itself (near-black in Buzz
    // Light, which would swallow that text). Other accents identify agents.
    '--cth-lemon': mix(c.primary, c.background, 22),
    '--cth-lemon-light': mix(c.primary, c.background, 10),
    '--cth-on-accent': c.foreground,
    '--cth-shadow-hard': theme.dark ? '0 1px 3px rgb(0 0 0 / 0.4)' : '0 1px 3px rgb(0 0 0 / 0.08)',
    // Buzz's type everywhere; the pixel face's tiny sizes grow to read in it.
    '--cth-text-display-sm': '10px',
    '--cth-text-display-md': '12px',
    '--cth-text-display-lg': '15px',
  };
  if (theme.fontFamily) {
    tokens['--cth-font-display'] = theme.fontFamily;
    tokens['--cth-font-ui'] = theme.fontFamily;
  }
  // Terminals and the per-agent session theme follow the app theme, as with the
  // Office's own toggle: running TUIs are told, new agents spawn matching.
  const mode = theme.dark ? 'dark' : 'light';
  if (mode !== appTheme()) {
    setAppTheme(mode);
    // The background mirror only draws: terminals and config are the main
    // frame's business.
    if (!mirrorRole) {
      notifyThemeChangeAll(mode);
      void window.cth?.updateConfig?.({ terminalTheme: mode });
    }
  }
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  if (!mirrorRole) setTerminalBackground(mode, c.card);
}

// ─── Command Center sections, driven from Buzz ──────────────────────────────
// Inside Buzz the Command Center's tab bar is hidden: Buzz renders the sections
// as its own navigation from what the docked panel reports here, and sends the
// user's choice back.

export interface PanelState {
  agentId: string | null;
  agentName: string | null;
  tabs: { key: string; label: string }[];
  tab: string | null;
}

let lastPanelState: PanelState | null = null;

/** The selected agent's panel (Michael's Command Center or a worker's panel)
 *  reports its sections and open tab; empty while no agent is selected. */
export function reportPanelState(state: PanelState): void {
  if (!hostedInBuzz) return;
  lastPanelState = state;
  window.parent.postMessage({ source: 'buzz-office', type: 'panel-state', ...state }, window.location.origin);
}

/** Open a section of the selected agent's panel. A Command Center section
 *  asked for while a worker is selected brings Michael's panel back first. */
function openSection(tab: string): void {
  const s = useStore.getState();
  const selected = s.agents.find((a) => a.id === s.selectedId);
  if (selected && !selected.isGod && SIDEBAR_TABS.some((d) => d.key === tab)) {
    s.setSidebarTab(tab as (typeof SIDEBAR_TABS)[number]['key']);
    return;
  }
  if (!selected?.isGod) {
    const god = s.agents.find((a) => a.isGod);
    if (god) s.select(god.id);
  }
  // After the select (which clears pending tab requests) has rendered the panel.
  setTimeout(() => useStore.getState().requestCommandCenterTab(tab), 0);
}

/** Tell Buzz while one of the Office's full-window overlays is open (add or
 *  edit an agent, the IDE, Settings, a fullscreen terminal): it gives the
 *  Office the whole page then, not just the terminal's box. */
function watchOverlays(): void {
  let open = false;
  let queued = false;
  const check = () => {
    queued = false;
    const now = !!document.querySelector('[style*="position: fixed"][style*="inset: 0"]');
    if (now === open) return;
    open = now;
    post({ type: 'overlay', open });
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(check);
  }).observe(document.body, { childList: true, subtree: true });
  check();
}

function post(message: Record<string, unknown>): void {
  window.parent.postMessage({ source: 'buzz-office', ...message }, window.location.origin);
}

/** Report where one agent stands every frame it moves (null stops). */
let tracked: string | null = null;
let trackFrame = 0;
let trackedAt = '';
function trackAgent(id: string | null): void {
  tracked = id;
  trackedAt = '';
  if (tracked && !trackFrame) trackFrame = requestAnimationFrame(trackStep);
}
function trackStep(): void {
  trackFrame = 0;
  if (!tracked) return;
  const at = locateAgent(tracked);
  const key = at ? `${Math.round(at.x)},${Math.round(at.y)}` : '';
  if (key !== trackedAt) {
    trackedAt = key;
    post({ type: 'agent-anchor', id: tracked, at });
  }
  trackFrame = requestAnimationFrame(trackStep);
}

if (mirrorRole) {
  // The background mirror: theme and the floor's state from the app, nothing
  // else (no API, no state reports, no host-ready).
  document.documentElement.dataset.cthHost = 'buzz';
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const m = event.data;
    if (m?.source !== 'buzz-office-host') return;
    if (m.type === 'theme' && m.theme?.colors) applyTheme(m.theme as HostTheme);
    if (m.type === 'mirror' && m.snapshot && Array.isArray(m.snapshot.agents)) {
      useStore.setState({
        agents: m.snapshot.agents,
        selectedId: m.snapshot.selectedId ?? null,
        officeTheme: m.snapshot.officeTheme ?? useStore.getState().officeTheme,
        ...(Array.isArray(m.snapshot.meetingAgentIds) ? { meetingAgentIds: m.snapshot.meetingAgentIds } : {}),
      });
    }
    if (m.type === 'locate-agent' && typeof m.id === 'string') {
      post({ type: 'agent-anchor', id: m.id, at: locateAgent(m.id) });
    }
    if (m.type === 'track-agent') trackAgent(typeof m.id === 'string' ? m.id : null);
    // Clicks on the app's Office page, passed in (this frame stays behind the
    // app, drawn whole; a see-through layer over the page forwards them).
    if (m.type === 'pointer' && typeof m.event === 'string' && typeof m.x === 'number' && typeof m.y === 'number') {
      const canvas = document.querySelector('canvas');
      canvas?.dispatchEvent(new PointerEvent(m.event, {
        clientX: m.x,
        clientY: m.y,
        button: typeof m.button === 'number' ? m.button : 0,
        buttons: typeof m.buttons === 'number' ? m.buttons : 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      }));
    }
  });
  // On the app's Office page this floor is the Office itself (the app lets
  // clicks through to it): a clicked character opens a chat above its head,
  // which follows the character frame by frame; the task board opens the
  // app's tasks window.
  onAgentClick((id) => post({ type: 'agent-click', id, at: locateAgent(id) }));
  useStore.subscribe((st, prev) => {
    const req = st.ccTabRequest;
    if (!req || req === prev.ccTabRequest) return;
    const page = req.tab === 'tasks' ? 'tasks' : req.tab === 'human' ? 'askme' : req.tab === 'meeting' ? 'meeting' : null;
    if (page) post({ type: 'navigate', page });
  });
  window.parent.postMessage({ source: 'buzz-office', type: 'mirror-ready' }, window.location.origin);
} else if (hostedInBuzz) {
  document.documentElement.dataset.cthHost = 'buzz';
  const style = document.createElement('style');
  style.textContent = HOSTED_CSS;
  document.head.appendChild(style);
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const m = event.data;
    if (m?.source !== 'buzz-office-host') return;
    if (m.type === 'view' && HOST_VIEWS.includes(m.view)) setView(m.view);
    if (m.type === 'theme' && m.theme?.colors) applyTheme(m.theme as HostTheme);
    if (m.type === 'panel-tab' && typeof m.tab === 'string') openSection(m.tab);
    if (m.type === 'add-agent') useStore.getState().setAddAgentOpen(true);
    if (m.type === 'panel-state-request' && lastPanelState) reportPanelState(lastPanelState);
    if (m.type === 'state-request') post(stateNow());
    if (m.type === 'mirror-request') post({ type: 'mirror', snapshot: mirrorSnapshot() });
    if (m.type === 'locate-agent' && typeof m.id === 'string') {
      post({ type: 'agent-anchor', id: m.id, at: locateAgent(m.id) });
    }
    if (m.type === 'api' && typeof m.op === 'string') {
      runBuzzApi(m.op, m.args ?? {}).then(
        (value) => post({ type: 'api-result', id: m.id, ok: true, value }),
        (error) => post({ type: 'api-result', id: m.id, ok: false, error: String(error?.message ?? error) })
      );
    }
  });
  // A character clicked on the floor: the app opens a chat above its head
  // (every click, even on the agent already selected).
  onAgentClick((id) => post({ type: 'agent-click', id, at: locateAgent(id) }));
  // Buzz's own UI for the Office's agents and tasks reads this snapshot.
  startStatePush(post);
  // …and the background mirror draws the floor from this one.
  startMirrorBroadcast();
  if (document.body) watchOverlays();
  else window.addEventListener('DOMContentLoaded', watchOverlays, { once: true });
  // The task board and Ask Me are Buzz pages: when the Office asks for those
  // Command Center tabs (the floor's task board, a question badge), Buzz opens
  // its page instead.
  useStore.subscribe((s, prev) => {
    const req = s.ccTabRequest;
    if (!req || req === prev.ccTabRequest) return;
    const page = req.tab === 'tasks' ? 'tasks' : req.tab === 'human' ? 'askme' : req.tab === 'meeting' ? 'meeting' : null;
    if (page) window.parent.postMessage({ source: 'buzz-office', type: 'navigate', page }, window.location.origin);
  });
  // Tell Buzz when the floor's agents change (a hire, a removal, the floor
  // restored at launch), so its view of them (status, membership) refreshes.
  let rosterKey = '';
  useStore.subscribe((s) => {
    const key = s.agents.map((a) => `${a.id}:${a.name}`).sort().join('|');
    if (key === rosterKey) return;
    rosterKey = key;
    window.parent.postMessage({ source: 'buzz-office', type: 'roster-changed' }, window.location.origin);
  });
  // Ask for the current view and theme: the host may have sent them before
  // this listener existed.
  window.parent.postMessage({ source: 'buzz-office', type: 'host-ready' }, window.location.origin);
}
