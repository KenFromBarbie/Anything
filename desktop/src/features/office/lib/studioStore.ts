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

// ─── A codebase's workspace (codebase_workspace.rs) ─────────────────────────

export type CodebaseGit =
  | { git: false }
  | {
      git: true;
      branch: string;
      upstream: string | null;
      ahead: number;
      behind: number;
      changedCount: number;
      changed: { status: string; path: string }[];
      commits: { sha: string; subject: string; author: string; at: number }[];
      branches: { name: string; at: number; current: boolean }[];
    };

export type GithubIssue = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  author?: { login: string };
  labels?: { name: string; color?: string }[];
  comments?: unknown[];
};

export type GithubPr = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  headRefName: string;
  isDraft: boolean;
  reviewDecision?: string;
  author?: { login: string };
};

export type CodebaseGithub = {
  repo: string;
  issues: GithubIssue[];
  prs: GithubPr[];
};

export type CodebaseMemory = { path: string; exists: boolean; text: string };

export type CodebaseGraph =
  | { built: false; graphPath: string }
  | {
      built: true;
      nodes: number;
      edges: number;
      communities: number;
      builtAt?: number;
      graphPath: string;
      htmlPath: string;
      reportPath: string;
      summary: string;
    };

export const codebaseKey = (id: string, part: string) =>
  ["office", "codebase", id, part] as const;

export function useCodebaseGit(id: string, enabled = true) {
  return useQuery({
    queryKey: codebaseKey(id, "git"),
    queryFn: () => invoke<CodebaseGit>("codebase_git", { id }),
    enabled: isTauri() && enabled,
  });
}

export function useCodebaseGithub(id: string, enabled = true) {
  return useQuery({
    queryKey: codebaseKey(id, "github"),
    queryFn: () => invoke<CodebaseGithub>("codebase_github", { id }),
    enabled: isTauri() && enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useCodebaseMemory(id: string, enabled = true) {
  return useQuery({
    queryKey: codebaseKey(id, "memory"),
    queryFn: () => invoke<CodebaseMemory>("codebase_memory", { id }),
    enabled: isTauri() && enabled,
  });
}

export function useCodebaseGraph(id: string, enabled = true) {
  return useQuery({
    queryKey: codebaseKey(id, "graph"),
    queryFn: () => invoke<CodebaseGraph>("codebase_graph", { id }),
    enabled: isTauri() && enabled,
  });
}

export const saveCodebaseMemory = (id: string, text: string) =>
  invoke<void>("codebase_memory_save", { id, text });
export const buildCodebaseGraph = (id: string) =>
  invoke<CodebaseGraph>("codebase_graph_build", { id });
export const openCodebaseGraph = (id: string) =>
  invoke<void>("codebase_graph_open", { id });
export const setCodebaseManaged = (id: string, managed: boolean) =>
  invoke<void>("codebase_set_managed", { id, managed });
