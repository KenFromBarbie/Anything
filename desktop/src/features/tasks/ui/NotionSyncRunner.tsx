import * as React from "react";

import { useOfficeAgents } from "@/features/office/lib/officeLink";
import { syncOfficeTasks } from "@/features/tasks/lib/notionSync";
import { useNotionStatus } from "@/features/tasks/lib/useTasksData";

const SYNC_EVERY_MS = 30_000;

/**
 * Keeps the agents' board and its Notion database in step while the Office is
 * running: once when it comes up, then every 30 seconds. It never starts the
 * Office itself; opening Agents, Office or Tasks does.
 */
export function NotionSyncRunner() {
  const { data: status } = useNotionStatus();
  const { loaded } = useOfficeAgents();
  const officeDb = status?.connected ? status.config.officeDb : null;

  React.useEffect(() => {
    if (!officeDb || !loaded) return;
    const run = () =>
      void syncOfficeTasks(officeDb).catch((error: unknown) =>
        console.warn("[notion-sync]", error),
      );
    run();
    const timer = setInterval(run, SYNC_EVERY_MS);
    return () => clearInterval(timer);
  }, [officeDb, loaded]);

  return null;
}
