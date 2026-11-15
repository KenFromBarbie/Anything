import { useEffect } from 'react';
import { useStore, type Agent } from '@/store/store';
import { restartAgent } from '@/components/agentRestart';

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
