import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useChannelsQuery } from "@/features/channels/hooks";
import {
  channelSlug,
  type ServerPlan,
} from "@/features/communities/lib/serverPlan";
import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import { startOffice } from "@/features/office/ui/OfficeHost";
import { createChannel, sendChannelMessage } from "@/shared/api/tauri";

/**
 * A new server's setup, saved when it's created and carried out once the app
 * is on it: channels and starter threads first (the relay), then the team is
 * hired and Michael gets the starting prompt (that server's own Office). Each
 * step is recorded as done, so a restart part-way never repeats one.
 */

const KEY = "anything.server-setup";

export type PendingSetup = ServerPlan & {
  relayUrl: string;
  workFolder: string;
  done: {
    channels?: boolean;
    threads?: boolean;
    agents?: string[];
    kickoff?: boolean;
  };
};

const sameRelay = (a: string, b: string) =>
  a.trim().replace(/\/+$/, "").toLowerCase() ===
  b.trim().replace(/\/+$/, "").toLowerCase();

function loadAll(): PendingSetup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveAll(all: PendingSetup[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Without storage the setup can't wait for the server; nothing to keep.
  }
}

export function savePendingSetup(setup: PendingSetup): void {
  saveAll([
    ...loadAll().filter((s) => !sameRelay(s.relayUrl, setup.relayUrl)),
    setup,
  ]);
}

function update(
  relayUrl: string,
  change: (s: PendingSetup) => PendingSetup | null,
) {
  const all = loadAll();
  const next: PendingSetup[] = [];
  for (const setup of all) {
    if (!sameRelay(setup.relayUrl, relayUrl)) next.push(setup);
    else {
      const changed = change(setup);
      if (changed) next.push(changed);
    }
  }
  saveAll(next);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Carry out the active server's pending setup, if it has one. */
export function useServerSetupRunner(relayUrl: string | undefined): void {
  const { data: channels, isSuccess } = useChannelsQuery();
  const { loaded: officeLoaded } = useOfficeAgents();
  const queryClient = useQueryClient();
  const running = React.useRef(false);
  // A step that failed isn't retried until the app restarts (no error loop).
  const failed = React.useRef(false);
  const [phase, setPhase] = React.useState(0);

  // Relay side: channels, then a first message per starter thread.
  React.useEffect(() => {
    if (!relayUrl || !isSuccess || running.current || failed.current) return;
    const setup = loadAll().find((s) => sameRelay(s.relayUrl, relayUrl));
    if (!setup || (setup.done.channels && setup.done.threads)) {
      if (setup) setPhase(1);
      return;
    }
    running.current = true;
    void (async () => {
      try {
        const byName = new Map(
          (channels ?? []).map((c) => [c.name.toLowerCase(), c.id]),
        );
        if (!setup.done.channels) {
          for (const channel of setup.channels) {
            const name = channelSlug(channel.name);
            if (!name || byName.has(name)) continue;
            const created = await createChannel({
              name,
              channelType: "stream",
              visibility: "open",
              description: channel.purpose || undefined,
            });
            byName.set(name, created.id);
          }
          update(relayUrl, (s) => ({
            ...s,
            done: { ...s.done, channels: true },
          }));
        }
        if (!setup.done.threads) {
          for (const thread of setup.threads) {
            const id = byName.get(channelSlug(thread.channel));
            if (!id || !thread.title.trim()) continue;
            await sendChannelMessage(id, `**${thread.title.trim()}**`);
          }
          update(relayUrl, (s) => ({
            ...s,
            done: { ...s.done, threads: true },
          }));
        }
        await queryClient.invalidateQueries();
        setPhase(1);
      } catch (error) {
        failed.current = true;
        toast.error(
          `Setting up the server's channels failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        running.current = false;
      }
    })();
  }, [relayUrl, isSuccess, channels, queryClient]);

  // Office side: hire the team, then hand Michael the starting prompt.
  React.useEffect(() => {
    if (!relayUrl || phase < 1) return;
    const setup = loadAll().find((s) => sameRelay(s.relayUrl, relayUrl));
    if (!setup) return;
    startOffice();
    if (!officeLoaded || running.current || failed.current) return;
    running.current = true;
    void (async () => {
      try {
        const hired = new Set(setup.done.agents ?? []);
        if (setup.agents.some((a) => !hired.has(a.name))) {
          const options = await callOffice<{ defaultProvider: string }>(
            "hire.options",
          );
          for (const agent of setup.agents) {
            if (hired.has(agent.name) || !agent.name.trim()) continue;
            await callOffice("agents.hire", {
              name: agent.name.trim(),
              cwd: setup.workFolder,
              provider: options.defaultProvider,
              description: agent.role.slice(0, 300),
              // The setup's team is the permanent staff: an office each,
              // and they hire floor workers as the work needs.
              staff: true,
            });
            hired.add(agent.name);
            update(relayUrl, (s) => ({
              ...s,
              done: { ...s.done, agents: [...hired] },
            }));
            await wait(400);
          }
        }
        if (!setup.done.kickoff && setup.prompt.trim()) {
          await callOffice("dispatch", { text: setup.prompt.trim() });
        }
        update(relayUrl, () => null);
        toast.success(
          `${setup.name} is set up: ${setup.channels.length} channels, ${setup.agents.length} permanent staff, and Michael has the plan.`,
        );
      } catch (error) {
        failed.current = true;
        toast.error(
          `Setting up the server's team failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        running.current = false;
      }
    })();
  }, [relayUrl, phase, officeLoaded]);
}
