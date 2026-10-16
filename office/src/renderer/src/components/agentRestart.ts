import { useStore, type Agent } from '@/store/store';
import { roleForHiveSpawn } from '@shared/agentRole';
import {
  type AgentProvider,
  buildSpawnCommand,
  inferAgentProvider,
  providerPreset,
  tokenizeCommand
} from '@/store/config';
import { acquireTerminal, disposeTerminal, resetTerminal } from './terminalPool';

export interface RestartOpts {
  resume?: boolean;
  provider?: AgentProvider;
  /** Resume if we can, start fresh if we can't, instead of refusing.
   *  "Restart & Continue" wants the hard failure — continuing is the entire
   *  point, so silently starting a blank session would be worse than an
   *  error. A model change wants the soft one: the user asked to change
   *  model, and an agent with no recorded session still has to get one. */
  resumeOptional?: boolean;
}

/**
 * Restart an agent's PTY in place: a model/provider change, or with `resume`
 * "Restart & Continue" (reattach the prior conversation — the escape hatch for a
 * garbled terminal). Shared by the Command Center's monitor and Buzz's Models &
 * budgets section. Throws with a readable reason; the old process is left
 * running when a precondition fails before the kill.
 */
export async function restartAgent(a: Agent, model: string | undefined, opts: RestartOpts = {}): Promise<void> {
  if (!a.ptyId) return;
  const updateAgent = useStore.getState().updateAgent;
  const cfg = await window.cth.getConfig();
  // Respawn on the same CLI this agent already runs on (inferred from its
  // command if not explicitly tagged) so an Antigravity/Codex worker stays on
  // its own binary. opts.provider overrides it (changing GOD's engine).
  const previousProvider = inferAgentProvider(a.command, a.provider);
  const provider = opts.provider ?? previousProvider;
  let resume = opts.resume === true && provider === previousProvider;
  if (opts.resume && !resume && !opts.resumeOptional) {
    throw new Error('Cannot resume a session through a different provider.');
  }
  let resumeSessionId: string | undefined;
  if (resume) {
    const giveUpOnResume = (reason: string) => {
      if (!opts.resumeOptional) throw new Error(reason);
      resume = false;
      resumeSessionId = undefined;
    };
    const registry = await window.cth.hiveRegistry();
    resumeSessionId = registry.agents[a.id]?.sessionId;
    if (!resumeSessionId) {
      giveUpOnResume('No recorded session ID; current process was left running.');
    } else if (provider === 'claude' && !(await window.cth.resolveSessionCwd(resumeSessionId))) {
      giveUpOnResume('Session transcript not found; current process was left running.');
    }
  }
  // Capture the live grid before replacing anything.
  const oldEntry = acquireTerminal(a.ptyId);
  let cols = oldEntry.term.cols || 100;
  let rows = oldEntry.term.rows || 30;
  try {
    oldEntry.fit.fit();
    cols = oldEntry.term.cols;
    rows = oldEntry.term.rows;
  } catch { /* host not sized yet */ }

  const killed = await window.cth.killPty(a.ptyId);
  // A pty that is ALREADY gone is the state this kill was trying to reach (the
  // session died on its own), so it is not a failure.
  if (!killed.ok && !/^no pty:/.test(killed.error ?? '')) {
    throw new Error(killed.error ?? 'Could not stop the current process.');
  }
  if (!resume) resetTerminal(a.ptyId);
  const command = buildSpawnCommand(cfg, model, provider);
  const [exe, ...args] = tokenizeCommand(command.trim());
  const res = await window.cth.spawnPty({
    id: a.ptyId,
    cwd: a.cwd,
    command: exe,
    args,
    provider,
    cols,
    rows,
    hive: {
      id: a.id,
      name: a.name,
      cwd: a.cwd,
      provider,
      isGod: a.isGod,
      isAssistant: a.isAssistant,
      role: roleForHiveSpawn(a)
    },
    resume,
    resumeSessionId,
    requireResume: resume
  });
  if (!res.ok) throw new Error(res.error ?? 'Restart failed.');
  if (resume && res.resumed !== true) {
    throw new Error('Resume was refused; no replacement session was accepted.');
  }
  if (resume) {
    // The replacement is accepted, so NOW it is safe to throw the old terminal
    // away; bump the generation so only this agent's terminal card remounts.
    disposeTerminal(a.ptyId);
    acquireTerminal(a.ptyId);
    updateAgent(a.id, {
      terminalGeneration: (a.terminalGeneration ?? 0) + 1,
      status: 'idle',
      action: 'recreating terminal…'
    });
  }
  // Record the model even on a resume (a same-provider model change resumes).
  updateAgent(a.id, resume
    ? { command: command.trim(), provider, model, status: 'idle', action: 'continuing…' }
    : {
        command: command.trim(),
        provider,
        model,
        status: 'idle',
        action: provider === previousProvider ? 'restarting…' : `switching to ${providerPreset(provider).label}…`
      });
}
