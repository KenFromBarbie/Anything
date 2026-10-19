import * as React from "react";
import { Bot, UserRound } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useOfficeAgents } from "@/features/office/lib/officeLink";
import {
  useNotionStatus,
  useOfficeTasks,
} from "@/features/tasks/lib/useTasksData";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { SegmentedControl } from "@/shared/ui/segmented-control";

import { AgentsBoard } from "./AgentsBoard";
import { DispatchCard } from "./DispatchCard";
import { MyTasksSheet } from "./MyTasksSheet";
import { NotionConnectDialog } from "./NotionConnectDialog";
import { NotionMark, NotionSyncControl } from "./NotionSyncControl";

type Sheet = "board" | "mine";
const SHEET_KEY = "buzz.tasks.sheet";

function readSheet(): Sheet {
  try {
    return localStorage.getItem(SHEET_KEY) === "mine" ? "mine" : "board";
  } catch {
    return "board";
  }
}

/**
 * Tasks: the agents' board (the Office's, in Buzz's own UI, with dispatch to
 * Michael) and your own task sheet. With Notion connected the board syncs both
 * ways with "Office tasks" and your sheet is the "My tasks" database.
 */
export function TasksPage() {
  const [sheet, setSheet] = React.useState<Sheet>(readSheet);
  const { agents } = useOfficeAgents();
  const { data: tasks = [], isLoading } = useOfficeTasks();
  const { data: notion } = useNotionStatus();
  const { goAskMe } = useAppNavigation();
  const myDb = notion?.connected ? notion.config.myDb : null;

  const choose = (next: Sheet) => {
    setSheet(next);
    try {
      localStorage.setItem(SHEET_KEY, next);
    } catch {
      // Remembering the sheet is a convenience.
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 sm:px-6"
      data-testid="tasks-page-content"
    >
      <PageHeader
        action={<NotionSyncControl />}
        description="What the agents are working on, and your own list."
        title="Tasks"
      />
      <SegmentedControl<Sheet>
        legend="Task sheet"
        onValueChange={choose}
        optionTestIdPrefix="tasks-sheet"
        options={[
          { value: "board", label: "Agents' board", Icon: Bot },
          { value: "mine", label: "My tasks", Icon: UserRound },
        ]}
        size="wide"
        testId="tasks-sheet"
        value={sheet}
      />
      {sheet === "board" ? (
        <>
          <DispatchCard agents={agents} />
          <AgentsBoard
            agents={agents}
            loading={isLoading}
            onOpenAskMe={() => goAskMe()}
            tasks={tasks}
          />
        </>
      ) : myDb ? (
        <MyTasksSheet myDb={myDb} />
      ) : (
        <ConnectForMyTasks connected={!!notion?.connected} />
      )}
    </div>
  );
}

function ConnectForMyTasks({ connected }: { connected: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
      <NotionMark className="h-8 w-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">Your task sheet lives in Notion</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Connect Notion and Anything sets up a “My tasks” database you can work
          from here or in Notion.
        </p>
      </div>
      <Button onClick={() => setOpen(true)} size="sm">
        {connected ? "Finish Notion setup" : "Connect Notion"}
      </Button>
      <NotionConnectDialog onOpenChange={setOpen} open={open} />
    </div>
  );
}
