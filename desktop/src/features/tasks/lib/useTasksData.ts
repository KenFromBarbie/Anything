import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import { startOffice } from "@/features/office/ui/OfficeHost";
import {
  addMyTask,
  listMyTasks,
  type MyTask,
  restoreMyTask,
  trashMyTask,
  updateMyTask,
} from "@/features/tasks/lib/myTasks";
import { DEFAULT_MY_MAP, notionStatus } from "@/features/tasks/lib/notion";
import {
  getSyncStatus,
  subscribeSyncStatus,
  syncOfficeTasks,
} from "@/features/tasks/lib/notionSync";

/** A task on the Office's board, as `tasks.list` returns it. */
export type OfficeTask = {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  status: "todo" | "doing" | "blocked" | "done";
  priority: number;
  createdAt: string;
  dependsOn?: string[];
  humanQA?: {
    q: string;
    a?: string;
    askedAt?: string;
    answeredAt?: string;
    dismissedAt?: string;
  }[];
};

export const NOTION_STATUS_KEY = ["notion", "status"] as const;
const OFFICE_TASKS_KEY = ["office", "tasks"] as const;
const myTasksKey = (db: string | null | undefined) =>
  ["notion", "my-tasks", db ?? ""] as const;

export function useNotionStatus() {
  return useQuery({
    queryKey: NOTION_STATUS_KEY,
    queryFn: notionStatus,
    staleTime: 60_000,
  });
}

export function useSyncStatus() {
  return React.useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}

/** The Office's board. Starts the Office (the board lives in it). */
export function useOfficeTasks() {
  const { loaded } = useOfficeAgents();
  React.useEffect(() => startOffice(), []);
  return useQuery({
    queryKey: OFFICE_TASKS_KEY,
    queryFn: () => callOffice<OfficeTask[]>("tasks.list"),
    enabled: loaded,
    refetchInterval: 4_000,
  });
}

/** Board changes, each followed by a Notion sync when connected. */
export function useOfficeTaskActions() {
  const client = useQueryClient();
  const { data: notion } = useNotionStatus();
  const officeDb = notion?.connected ? notion.config.officeDb : null;
  const settle = React.useCallback(async () => {
    await client.invalidateQueries({ queryKey: OFFICE_TASKS_KEY });
    if (officeDb) void syncOfficeTasks(officeDb).catch(() => undefined);
  }, [client, officeDb]);

  const add = useMutation({
    mutationFn: (fields: Partial<OfficeTask> & { title: string }) =>
      callOffice<OfficeTask>("tasks.add", fields),
    onSettled: settle,
  });
  const patch = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<OfficeTask> }) =>
      callOffice("tasks.patch", { id, patch }),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: OFFICE_TASKS_KEY });
      client.setQueryData<OfficeTask[]>(OFFICE_TASKS_KEY, (tasks) =>
        tasks?.map((task) => (task.id === id ? { ...task, ...patch } : task)),
      );
    },
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => callOffice("tasks.delete", { id }),
    onSettled: settle,
  });
  const dispatch = useMutation({
    mutationFn: (fields: { text: string; suggestedId?: string }) =>
      callOffice("dispatch", fields),
  });
  return { add, patch, remove, dispatch };
}

/** Answering or dismissing an agent's question (Ask Me). */
export function useAskMeActions() {
  const client = useQueryClient();
  const settle = () => client.invalidateQueries({ queryKey: OFFICE_TASKS_KEY });
  const answer = useMutation({
    mutationFn: (fields: { taskId: string; q: string; text: string }) =>
      callOffice("askme.answer", fields),
    onSettled: settle,
  });
  const dismiss = useMutation({
    mutationFn: (fields: { taskId: string; q: string }) =>
      callOffice("askme.dismiss", fields),
    onSettled: settle,
  });
  return { answer, dismiss };
}

/** The column map of the owner's sheet. */
export function useMyMap() {
  const { data } = useNotionStatus();
  return data?.config.myMap ?? DEFAULT_MY_MAP;
}

/** The owner's sheet in Notion. */
export function useMyTasks(myDb: string | null | undefined) {
  const map = useMyMap();
  return useQuery({
    queryKey: [...myTasksKey(myDb), map],
    queryFn: () => listMyTasks(myDb ?? "", map),
    enabled: !!myDb,
    refetchInterval: 30_000,
  });
}

export function useMyTaskActions(myDb: string | null | undefined) {
  const client = useQueryClient();
  const map = useMyMap();
  const key = [...myTasksKey(myDb), map];
  const settle = () => client.invalidateQueries({ queryKey: myTasksKey(myDb) });

  const add = useMutation({
    mutationFn: (fields: { title: string; due?: string | null }) =>
      addMyTask(myDb ?? "", map, fields),
    onSuccess: (task) =>
      client.setQueryData<MyTask[]>(key, (tasks) => [...(tasks ?? []), task]),
    onSettled: settle,
  });
  const update = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<MyTask, "title" | "status" | "due" | "notes">>;
    }) => updateMyTask(map, id, patch),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData<MyTask[]>(key, (tasks) =>
        tasks?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },
    onSettled: settle,
  });
  const trash = useMutation({
    mutationFn: (id: string) => trashMyTask(map, id),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData<MyTask[]>(key, (tasks) =>
        tasks?.filter((t) => t.id !== id),
      );
    },
    onSettled: settle,
  });
  const restore = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MyTask["status"] }) =>
      restoreMyTask(map, id, status),
    onSettled: settle,
  });
  return { add, update, trash, restore };
}

export { notionUrl } from "@/features/tasks/lib/notion";
