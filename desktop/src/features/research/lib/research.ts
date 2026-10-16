import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import {
  isOfficeAgent,
  isOfficeWorker,
} from "@/features/agents/lib/managedAgentControlActions";
import {
  addChannelMembers,
  createChannel,
  invokeTauri,
  listManagedAgents,
  sendChannelMessage,
} from "@/shared/api/tauri";

/** A research project: a folder on disk, with a cover, a pin, and the chat
 *  where Michael works on it. */
export type ResearchProject = {
  id: string;
  name: string;
  path: string;
  description: string;
  pinned: boolean;
  image: string | null;
  channelId: string | null;
  createdAt: number;
  updatedAt: number;
  /** False when the folder has been moved or deleted outside Buzz. */
  exists: boolean;
};

export type ResearchState = { root: string; projects: ResearchProject[] };

export type ResearchFile = {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
};

type ProjectPatch = Partial<
  Pick<ResearchProject, "name" | "description" | "pinned">
> & { channelId?: string };

export const RESEARCH_KEY = ["research"] as const;
const coverKey = (id: string, image: string | null) =>
  ["research", "cover", id, image ?? ""] as const;
const filesKey = (id: string) => ["research", "files", id] as const;

export const researchApi = {
  list: () => invokeTauri<ResearchState>("research_list"),
  create: (name: string, description: string) =>
    invokeTauri<ResearchProject>("research_create", { name, description }),
  update: (id: string, patch: ProjectPatch) =>
    invokeTauri<ResearchProject>("research_update", { id, patch }),
  pickImage: (id: string) =>
    invokeTauri<ResearchProject | null>("research_pick_image", { id }),
  clearImage: (id: string) =>
    invokeTauri<ResearchProject>("research_clear_image", { id }),
  image: (id: string) => invokeTauri<string | null>("research_image", { id }),
  pickFolder: () => invokeTauri<ResearchProject | null>("research_pick_folder"),
  pickRoot: () => invokeTauri<ResearchState | null>("research_pick_root"),
  remove: (id: string) => invokeTauri<void>("research_remove", { id }),
  files: (id: string) => invokeTauri<ResearchFile[]>("research_files", { id }),
  open: (id: string, file?: string) =>
    invokeTauri<void>("research_open", { id, file: file ?? null }),
};

/** Pinned first, then most recently touched. */
export function sortProjects(projects: ResearchProject[]): ResearchProject[] {
  return [...projects].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}

/** A short project name from the owner's description of it. */
export function proposeName(brief: string): string {
  const firstLine = brief.trim().split(/\n|[.?!](\s|$)/)[0] ?? "";
  const cleaned = firstLine
    .replace(
      /^(please\s+)?(i\s+(want|need|would like)\s+(you\s+)?to\s+|can you\s+|help me\s+|let'?s\s+)?(research|look into|investigate|find out about|study|explore)\s+/i,
      "",
    )
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 7).join(" ");
  if (!words) return "New research";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function channelName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `research-${slug || "project"}`;
}

/** Michael: the Office's own agent (not one of the floor's workers). */
async function michaelPubkey(): Promise<string | null> {
  const agents = await listManagedAgents();
  const michael = agents.find(
    (agent) => isOfficeAgent(agent) && !isOfficeWorker(agent),
  );
  return michael?.pubkey ?? null;
}

/** Copies an attached file into the project's `sources/` folder; returns
 *  its path inside the project. */
export async function saveAttachment(
  projectId: string,
  file: File,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("research_save_file", bytes, {
    headers: {
      "x-project": projectId,
      "x-name": encodeURIComponent(file.name),
    },
  });
}

function briefFor(
  project: ResearchProject,
  brief: string,
  attached: string[],
): string {
  return [
    `New research project: **${project.name}**`,
    "",
    brief.trim(),
    "",
    `Project folder: \`${project.path}\``,
    ...(attached.length > 0
      ? [
          "",
          "I've attached these (they're in the project folder):",
          ...attached.map((path) => `- \`${path}\``),
        ]
      : []),
    "",
    "Please research this, and save what you find into the project folder as you go (notes, sources, summaries as Markdown files; keep README.md up to date with the overview and where things stand). Ask me here if anything is unclear.",
  ].join("\n");
}

export type StartedProject = {
  project: ResearchProject;
  channelId: string;
  /** False when Michael isn't set up, so the brief went unanswered. */
  michaelAdded: boolean;
};

/**
 * Starts a project from a chat: makes its folder, opens a private channel for
 * it, brings Michael in, and posts the brief to him there.
 */
export async function startProject(
  name: string,
  brief: string,
  files: File[] = [],
): Promise<StartedProject> {
  const project = await researchApi.create(name, brief.trim());
  const attached: string[] = [];
  for (const file of files)
    attached.push(await saveAttachment(project.id, file));
  const channel = await createChannel({
    name: channelName(project.name),
    channelType: "stream",
    visibility: "private",
    description: `Research: ${project.name}`,
  });
  const linked = await researchApi.update(project.id, {
    channelId: channel.id,
  });
  const michael = await michaelPubkey().catch(() => null);
  if (michael) {
    await addChannelMembers({ channelId: channel.id, pubkeys: [michael] });
  }
  await sendChannelMessage(
    channel.id,
    briefFor(linked, brief, attached),
    null,
    undefined,
    michael ? [michael] : undefined,
  );
  return { project: linked, channelId: channel.id, michaelAdded: !!michael };
}

export function useResearch() {
  return useQuery({
    queryKey: RESEARCH_KEY,
    queryFn: researchApi.list,
    refetchInterval: 15_000,
  });
}

export function useProjectCover(project: ResearchProject) {
  return useQuery({
    queryKey: coverKey(project.id, project.image),
    queryFn: () => researchApi.image(project.id),
    enabled: !!project.image,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useProjectFiles(id: string | null) {
  return useQuery({
    queryKey: filesKey(id ?? ""),
    queryFn: () => researchApi.files(id ?? ""),
    enabled: !!id,
    refetchInterval: 10_000,
  });
}

/** Adds files to a project's `sources/` folder. */
export function useAddProjectFiles(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) => {
      const saved: string[] = [];
      for (const file of files)
        saved.push(await saveAttachment(projectId, file));
      return saved;
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: filesKey(projectId) }),
  });
}

export function useResearchActions() {
  const client = useQueryClient();
  const settle = () => client.invalidateQueries({ queryKey: RESEARCH_KEY });
  const setProject = (project: ResearchProject | null) => {
    if (!project) return;
    client.setQueryData<ResearchState>(RESEARCH_KEY, (state) =>
      state
        ? {
            ...state,
            projects: state.projects.some((p) => p.id === project.id)
              ? state.projects.map((p) => (p.id === project.id ? project : p))
              : [...state.projects, project],
          }
        : state,
    );
  };

  return {
    start: useMutation({
      mutationFn: ({
        name,
        brief,
        files,
      }: {
        name: string;
        brief: string;
        files: File[];
      }) => startProject(name, brief, files),
      onSuccess: ({ project }) => setProject(project),
      onSettled: settle,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: ProjectPatch }) =>
        researchApi.update(id, patch),
      onMutate: ({ id, patch }) => {
        client.setQueryData<ResearchState>(RESEARCH_KEY, (state) =>
          state
            ? {
                ...state,
                projects: state.projects.map((p) =>
                  p.id === id ? { ...p, ...patch } : p,
                ),
              }
            : state,
        );
      },
      onSuccess: setProject,
      onSettled: settle,
    }),
    pickImage: useMutation({
      mutationFn: researchApi.pickImage,
      onSuccess: setProject,
    }),
    clearImage: useMutation({
      mutationFn: researchApi.clearImage,
      onSuccess: setProject,
    }),
    addFolder: useMutation({
      mutationFn: researchApi.pickFolder,
      onSuccess: setProject,
      onSettled: settle,
    }),
    pickRoot: useMutation({
      mutationFn: researchApi.pickRoot,
      onSuccess: (state) => {
        if (state) client.setQueryData(RESEARCH_KEY, state);
      },
    }),
    remove: useMutation({
      mutationFn: researchApi.remove,
      onSettled: settle,
    }),
  };
}
