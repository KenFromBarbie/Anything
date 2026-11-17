import { useEffect } from 'react';
import { useStore, type Agent } from '@/store/store';
import { restartAgent } from '@/components/agentRestart';
import { restoreFromHost } from './useRestoreTeam';

/**
 * Dormant floor workers: a hired worker that has sat idle for a while has its
 * terminal closed (it costs memory and nothing else), but stays on the floor.
 * Mail or a queued message for it wakes it on its previous conversation
 * (--resume), so nothing it knew is lost. The CEO, the executives (staff) and
 * Michael's assistant are never put to sleep.
 */
const DORMANT_AFTER_MS = 10 * 60_000;
const CHECK_MS = 60_000;
const RESTING: Agent['status'][] = ['idle', 'success'];

export function canGoDormant(a: Agent): boolean {
  return !!a.ptyId && !a.isGod && !a.isAssistant && !a.staff && !a.onHold && a.id.startsWith('worker-');
}

const waking = new Set<string>();

/** Wake a dormant agent (once at a time); resolves when its terminal is back. */
export async function wakeDormant(a: Agent): Promise<void> {
  if (!a.dormant || waking.has(a.id)) return;
  waking.add(a.id);
  try {
    await restartAgent(a, a.model, { resume: true, resumeOptional: true });
    useStore.getState().updateAgent(a.id, { dormant: false, action: 'back at work' });
  } catch (err) {
    console.error('[dormancy] could not wake', a.id, err);
  } finally {
    waking.delete(a.id);
  }
}

/** Puts idle floor workers to sleep (see above). */
export function useDormancy(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const busySince: Record<string, number> = {};
    const iv = setInterval(() => {
      const now = Date.now();
      const { agents, messageQueues, updateAgent } = useStore.getState();
      for (const a of agents) {
        if (!canGoDormant(a) || a.dormant) continue;
        const resting = RESTING.includes(a.status) && !(messageQueues[a.id]?.length);
        if (!resting) { busySince[a.id] = now; continue; }
        const last = busySince[a.id] ?? (busySince[a.id] = now);
        if (now - last < DORMANT_AFTER_MS) continue;
        void window.cth.killPty(a.ptyId!).then(() => {
          updateAgent(a.id, { dormant: true, status: 'idle', action: 'resting (terminal closed until needed)' });
        }).catch(() => undefined);
      }
    }, CHECK_MS);
    return () => clearInterval(iv);
  }, [enabled]);
}

/**
 * The CEO brings the team back himself (restore-requests, see main): agents
 * from the last session are restored as the Restore team button does, and a
 * named agent that is resting is woken.
 */
export function useCeoRestores(enabled: boolean): void {
  // The executives are standing roles: after a restart they come back on
  // their own (the CEO can't delegate to an empty office).
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      const staff = useStore.getState().restorableAgents.filter((a) => a.staff).map((a) => a.id);
      if (staff.length) void restoreFromHost(staff).catch((err) => console.error('[restore] executives', err));
    }, 15_000);
    return () => clearTimeout(t);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const iv = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const requests = await window.cth.takeRestoreRequests();
        for (const r of requests) {
          const { agents, restorableAgents } = useStore.getState();
          for (const a of agents) {
            if (a.dormant && (r.all || r.ids.includes(a.id))) await wakeDormant(a);
          }
          const ids = r.all ? undefined : r.ids.filter((id) => restorableAgents.some((a) => a.id === id));
          if (ids && ids.length === 0) continue;
          if (restorableAgents.length === 0) continue;
          await restoreFromHost(ids).catch((err) => console.error('[restore] CEO restore failed', err));
        }
      } catch {
        /* the Office is still starting: next tick */
      } finally {
        busy = false;
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [enabled]);
}

/**
 * The restore list stays short: a floor worker whose job is over (no open
 * task of its own, not seen for 12 hours) leaves it on its own, at start and
 * every half hour. Set aside, not deleted: its folder and notes stay.
 */
export function useTidyRestorable(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const tidy = async () => {
      try {
        const { restorableAgents, removeRestorableAgent } = useStore.getState();
        const workers = restorableAgents.filter((a) => a.id.startsWith('worker-'));
        if (!workers.length) return;
        const [reg, raw] = await Promise.all([window.cth.hiveRegistry(), window.cth.hiveTasks()]);
        const tasks = (Array.isArray(raw) ? raw : ((raw as { tasks?: unknown[] } | null)?.tasks ?? [])) as { assignee?: string; status?: string }[];
        const now = Date.now();
        for (const a of workers) {
          const open = tasks.some((t) => t.assignee === a.id && t.status !== 'done');
          const seen = Number((reg.agents?.[a.id] as { lastSeen?: number } | undefined)?.lastSeen ?? 0);
          if (open || now - seen < 12 * 3_600_000) continue;
          removeRestorableAgent(a.id);
        }
      } catch {
        /* next round */
      }
    };
    const first = setTimeout(() => void tidy(), 20_000);
    const iv = setInterval(() => void tidy(), 30 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [enabled]);
}
