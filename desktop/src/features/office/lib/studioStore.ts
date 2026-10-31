// The owner's own Studio tiles and linked codebases, kept per server in the
// Office's hive (see studio_store.rs).

import { useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";

import type { Codebase, StudioWorkflow } from "./studioRequests";

export const WORKFLOWS_KEY = ["office", "studio-workflows"] as const;
export const CODEBASES_KEY = ["office", "codebases"] as const;

export function useStudioWorkflows() {
  return useQuery({
    queryKey: WORKFLOWS_KEY,
    queryFn: () => invoke<StudioWorkflow[]>("studio_workflows"),
    enabled: isTauri(),
  });
}

export function useCodebases() {
  return useQuery({
    queryKey: CODEBASES_KEY,
    queryFn: () => invoke<Codebase[]>("codebases"),
    enabled: isTauri(),
  });
}

export const saveWorkflow = (workflow: Partial<StudioWorkflow>) =>
  invoke<StudioWorkflow>("studio_workflow_save", { workflow });
export const deleteWorkflow = (id: string) =>
  invoke<void>("studio_workflow_delete", { id });

export const addCodebase = (source: string) =>
  invoke<Codebase>("codebase_add", { source });
export const pullCodebase = (id: string) =>
  invoke<{ said: string; codebase: Codebase }>("codebase_pull", { id });
export const openCodebase = (id: string) =>
  invoke<void>("codebase_open", { id });
export const removeCodebase = (id: string) =>
  invoke<void>("codebase_remove", { id });
