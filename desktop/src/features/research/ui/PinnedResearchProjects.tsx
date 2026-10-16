import { useRouterState } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { sortProjects, useResearch } from "@/features/research/lib/research";
import {
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/shared/ui/sidebar";

import { ProjectCover } from "./ProjectCover";

/** Pinned research projects, listed under Research in the sidebar. */
export function PinnedResearchProjects() {
  const { data } = useResearch();
  const { goResearch } = useAppNavigation();
  const location = useRouterState({ select: (state) => state.location });
  const pinned = sortProjects(data?.projects ?? []).filter((p) => p.pinned);
  if (pinned.length === 0) return null;
  const openId =
    location.pathname === "/research"
      ? (location.search as { project?: string }).project
      : undefined;

  return (
    <SidebarMenuItem>
      <SidebarMenuSub data-testid="pinned-research-projects">
        {pinned.map((project) => (
          <SidebarMenuSubItem key={project.id}>
            <SidebarMenuSubButton
              asChild
              isActive={openId === project.id}
              size="sm"
            >
              <button
                className="w-full"
                onClick={() => void goResearch(project.id)}
                title={project.name}
                type="button"
              >
                <ProjectCover className="h-4 w-4 rounded" project={project} />
                <span>{project.name}</span>
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}
