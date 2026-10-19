import * as React from "react";
import { useLocation } from "@tanstack/react-router";
import {
  ChevronDown,
  FileText,
  Files,
  Film,
  Image as ImageIcon,
  MessagesSquare,
  Music,
} from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  type CommunityFile,
  fileKind,
  useCommunityFiles,
} from "@/features/files/lib/useCommunityFiles";
import { getThreadReference } from "@/features/messages/lib/threading";
import { cn } from "@/shared/lib/cn";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

const SECTION_LABEL_BUTTON_CLASS =
  "group/section-label flex w-fit max-w-[calc(100%-3rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS =
  "relative size-2.5 shrink-0 text-current opacity-0 transition-[color,opacity] group-hover/sidebar-section:opacity-100 group-hover/section-label:opacity-100 group-focus-within/sidebar-section:opacity-100 group-focus-visible/section-label:opacity-100";
const SECTION_LABEL_CHEVRON_ICON_CLASS =
  "absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2";

const SHOWN = 6;

function Section({
  children,
  testId,
  title,
}: {
  children: React.ReactNode;
  testId: string;
  title: string;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <SidebarGroup className="group/sidebar-section select-none">
      <SidebarGroupLabel asChild>
        <button
          aria-expanded={!collapsed}
          className={SECTION_LABEL_BUTTON_CLASS}
          data-testid={`${testId}-section-label`}
          onClick={() => setCollapsed((value) => !value)}
          type="button"
        >
          <span data-sidebar-section-title>{title}</span>
          <span aria-hidden="true" className={SECTION_LABEL_CHEVRON_CLASS}>
            <ChevronDown
              className={cn(
                SECTION_LABEL_CHEVRON_ICON_CLASS,
                collapsed ? "-rotate-90" : "rotate-0",
              )}
            />
          </span>
        </button>
      </SidebarGroupLabel>
      {collapsed ? null : (
        <SidebarGroupContent>
          <SidebarMenu data-testid={testId}>{children}</SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 py-1 text-xs text-sidebar-foreground/50">{children}</li>
  );
}

function firstLine(text: string): string {
  const line = text
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[*_`#>]/g, "")
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? "Thread";
}

/**
 * Threads in this community that have activity for you, newest first: the
 * same ones the Inbox's thread view lists. Each opens its channel with the
 * thread open.
 */
export function SidebarThreadsSection() {
  const { threadActivityFeedItems } = useAppShell();
  const { goChannel } = useAppNavigation();
  const threads = React.useMemo(() => {
    const byRoot = new Map<
      string,
      {
        rootId: string;
        channelId: string;
        channelName: string;
        text: string;
        at: number;
      }
    >();
    for (const item of threadActivityFeedItems) {
      if (!item.channelId) continue;
      const rootId = getThreadReference(item.tags).rootId ?? item.id;
      const existing = byRoot.get(rootId);
      if (existing && existing.at >= item.createdAt) continue;
      byRoot.set(rootId, {
        rootId,
        channelId: item.channelId,
        channelName: item.channelName ?? "",
        text: firstLine(item.content),
        at: item.createdAt,
      });
    }
    return [...byRoot.values()].sort((a, b) => b.at - a.at).slice(0, SHOWN);
  }, [threadActivityFeedItems]);

  return (
    <Section testId="sidebar-threads" title="Threads">
      {threads.length === 0 ? <Empty>No active threads</Empty> : null}
      {threads.map((thread) => (
        <SidebarMenuItem key={thread.rootId}>
          <SidebarMenuButton
            className="h-auto py-1.5"
            onClick={() =>
              void goChannel(thread.channelId, { thread: thread.rootId })
            }
            tooltip={thread.text}
            type="button"
          >
            <MessagesSquare className="h-4 w-4 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <SidebarMenuLabel className="truncate">
                {thread.text}
              </SidebarMenuLabel>
              {thread.channelName ? (
                <span className="truncate text-[11px] text-sidebar-foreground/50">
                  #{thread.channelName}
                </span>
              ) : null}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </Section>
  );
}

export function FileKindIcon({
  file,
  className,
}: {
  file: Pick<CommunityFile, "type">;
  className?: string;
}) {
  const kind = fileKind(file);
  const Icon =
    kind === "image"
      ? ImageIcon
      : kind === "video"
        ? Film
        : kind === "audio"
          ? Music
          : FileText;
  return <Icon className={className} />;
}

/** The latest files shared in this community, and the way to all of them. */
export function SidebarFilesSection() {
  const { data: files = [], isLoading } = useCommunityFiles();
  const { goChannel, goFiles } = useAppNavigation();
  const location = useLocation();
  return (
    <Section testId="sidebar-files" title="Files">
      <SidebarMenuItem>
        <SidebarMenuButton
          className="data-[active=true]:font-normal"
          data-testid="open-files-view"
          isActive={location.pathname === "/files"}
          onClick={() => void goFiles()}
          tooltip="All files"
          type="button"
        >
          <Files className="h-4 w-4" />
          <SidebarMenuLabel>All files</SidebarMenuLabel>
          {files.length > 0 ? (
            <span className="ml-auto text-xs tabular-nums text-sidebar-foreground/50">
              {files.length}
            </span>
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
      {!isLoading && files.length === 0 ? (
        <Empty>No files shared yet</Empty>
      ) : null}
      {files.slice(0, SHOWN - 1).map((file) => (
        <SidebarMenuItem key={file.key}>
          <SidebarMenuButton
            onClick={() =>
              void goChannel(file.channelId, { messageId: file.eventId })
            }
            tooltip={`${file.name} · #${file.channelName}`}
            type="button"
          >
            <FileKindIcon className="h-4 w-4 shrink-0" file={file} />
            <SidebarMenuLabel className="truncate">
              {file.name}
            </SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </Section>
  );
}
