import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * The Studio is installed on demand: its UI is downloaded from this version's
 * GitHub release (see `studio.rs`), with the tools the owner picked.
 */
export type StudioStatus = {
  installed: boolean;
  /** A local development build is in use (BUZZ_STUDIO_DIR). */
  devBuild: boolean;
  version: string | null;
  appVersion: string;
  tools: string[];
  allTools: string[];
};

export type StudioProgress = {
  phase: "downloading" | "installing" | "done";
  received: number;
  total: number | null;
};

/** The Studio's tools, as the owner sees them. */
export const STUDIO_TOOLS: { id: string; label: string; detail: string }[] = [
  { id: "2D", label: "Image Editor", detail: "Layers, shapes and drawing" },
  { id: "3D", label: "3D Stage", detail: "Build and frame 3D scenes" },
  {
    id: "VIDEO_EDITOR",
    label: "Video Editor",
    detail: "Cut and assemble clips on a timeline",
  },
  {
    id: "VIDEO_FRAME_EXTRACTOR",
    label: "Frame Extractor",
    detail: "Pull still frames out of videos",
  },
  { id: "STORYBOARD", label: "Storyboard", detail: "Plan shots visually" },
  { id: "MOODBOARD", label: "Moodboard", detail: "Collect references" },
];

const STATUS_KEY = ["studio", "status"] as const;

export function useStudioStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => invoke<StudioStatus>("studio_status"),
    enabled: isTauri(),
    staleTime: 30_000,
  });
}

/** Download progress while an install runs. */
export function useStudioProgress(): StudioProgress | null {
  const [progress, setProgress] = React.useState<StudioProgress | null>(null);
  React.useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<StudioProgress>("studio-install-progress", (event) =>
      setProgress(event.payload.phase === "done" ? null : event.payload),
    ).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);
  return progress;
}

export function useStudioActions() {
  const client = useQueryClient();
  const settle = (status: StudioStatus) =>
    client.setQueryData(STATUS_KEY, status);
  return {
    install: useMutation({
      mutationFn: (tools: string[]) =>
        invoke<StudioStatus>("studio_install", { tools }),
      onSuccess: settle,
    }),
    setTools: useMutation({
      mutationFn: (tools: string[]) =>
        invoke<StudioStatus>("studio_set_tools", { tools }),
      onSuccess: settle,
    }),
    uninstall: useMutation({
      mutationFn: () => invoke<StudioStatus>("studio_uninstall"),
      onSuccess: settle,
    }),
  };
}

export function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
