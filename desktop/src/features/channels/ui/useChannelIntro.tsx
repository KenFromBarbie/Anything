import * as React from "react";
import {
  Bot,
  Building2,
  FolderPlus,
  Plus,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";

import {
  getChannelIntroDescription,
  getChannelIntroKind,
} from "@/features/channels/ui/ChannelPane.helpers";
import {
  isWelcomeChannel,
  isWelcomeExperienceChannel,
} from "@/features/onboarding/welcome";
import { openMeetingDialog } from "@/features/office/lib/meetingRoom";
import { useIsProjectHomeChannel } from "@/features/projects/lib/projectHomeChannel";
import { ProjectChannelIcon } from "@/features/projects/ui/ProjectChannelIcon";
import type { Channel } from "@/shared/api/types";
import { HashSearch } from "@/shared/ui/icons";

/** What the Welcome channel says first: how the office works and how to
 *  get it going. */
const WELCOME_INTRO = [
  "Michael runs your office here. Tell him what you need and he splits it between your permanent staff, who hire floor workers for the work and report back to him. You get one answer.",
  "",
  "To start, mention @Michael below with what you're working on: the goal, who it's for and what done looks like. Attach files or paste links and the agents read them first. For example:",
  '• "Plan the first month and give each of the staff their part."',
  '• "Summarise the attached brief and list the questions you need me to answer."',
  '• "Every Monday, send me what got done last week and what\'s next."',
].join("\n");

type ChannelIntroAction = {
  description?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
};

/**
 * Builds the empty-channel intro block (heading, description, action cards)
 * for the channel timeline. The Welcome channel gets its onboarding trio
 * (browse / create channel / create agent); other channels get contextual
 * member actions.
 */
export function useChannelIntro({
  activeChannel,
  onAddAgent,
  onAddFiles,
  onBrowseChannels,
  onCreateChannel,
  onOpenMembers,
  onWelcomeAddAgent,
}: {
  activeChannel: Channel | null;
  onAddAgent?: (options?: { beforeSend?: () => void }) => void;
  onAddFiles?: () => void;
  onBrowseChannels?: () => void;
  onCreateChannel?: () => void;
  onOpenMembers?: () => void;
  onWelcomeAddAgent?: () => void;
}) {
  const projectHome = useIsProjectHomeChannel(activeChannel?.id);

  return React.useMemo(() => {
    if (!activeChannel || activeChannel.channelType === "dm") {
      return null;
    }

    const actions: ChannelIntroAction[] = [];
    if (isWelcomeExperienceChannel(activeChannel)) {
      actions.push({
        description: "See who's at their desk and what they're on.",
        icon: <Building2 aria-hidden className="h-6 w-6" />,
        label: "Open the Office",
        onClick: () => {
          window.location.hash = "#/office";
        },
        testId: "welcome-intro-action-office",
      });
      actions.push({
        description: "Talk it through out loud with the team.",
        icon: <Users aria-hidden className="h-6 w-6" />,
        label: "Call a meeting",
        onClick: openMeetingDialog,
        testId: "welcome-intro-action-meeting",
      });
      if (onBrowseChannels) {
        actions.push({
          description: "Every workstream has its own.",
          icon: <HashSearch aria-hidden className="h-6 w-6" />,
          label: "Browse channels",
          onClick: onBrowseChannels,
          testId: "welcome-intro-action-browse-channels",
        });
      }

      if (onCreateChannel) {
        actions.push({
          description: "Start a new stream of work.",
          icon: <Plus aria-hidden className="h-6 w-6" />,
          label: "Create a channel",
          onClick: onCreateChannel,
          testId: "welcome-intro-action-create-channel",
        });
      }

      if (onWelcomeAddAgent) {
        actions.push({
          description: "Add someone for a new kind of work.",
          icon: <Bot aria-hidden className="h-6 w-6" />,
          label: "Hire an agent",
          onClick: onWelcomeAddAgent,
          testId: "welcome-intro-action-create-agent",
        });
      }

      return {
        actions,
        channelKindLabel: isWelcomeChannel(activeChannel)
          ? "private welcome channel"
          : getChannelIntroKind(activeChannel, projectHome),
        channelName: activeChannel.name,
        description: isWelcomeChannel(activeChannel)
          ? WELCOME_INTRO
          : getChannelIntroDescription(activeChannel),
        icon: <Sparkles aria-hidden className="h-7 w-7" />,
      };
    }

    if (!activeChannel.archivedAt && activeChannel.isMember) {
      if (onAddFiles) {
        actions.push({
          description: "Add a repo.",
          icon: <FolderPlus aria-hidden className="h-5 w-5" />,
          label: "Add files",
          onClick: onAddFiles,
          testId: "channel-intro-action-add-files",
        });
      }

      if (onAddAgent) {
        actions.push({
          description: "Add an agent here.",
          icon: <Bot aria-hidden className="h-5 w-5" />,
          label: "Add agent",
          onClick: onAddAgent,
          testId: "channel-intro-action-create-agent",
        });
      }

      if (onOpenMembers) {
        actions.push({
          description: "Invite members.",
          icon: <UserPlus aria-hidden className="h-5 w-5" />,
          label: "Add people",
          onClick: onOpenMembers,
          testId: "channel-intro-action-add-people",
        });
      }
    }

    return {
      actions,
      channelKindLabel: getChannelIntroKind(activeChannel, projectHome),
      channelName: activeChannel.name,
      description: getChannelIntroDescription(activeChannel),
      hideBeginning: projectHome,
      icon: projectHome ? (
        <ProjectChannelIcon className="h-7 w-7" />
      ) : undefined,
    };
  }, [
    activeChannel,
    onAddAgent,
    onAddFiles,
    onBrowseChannels,
    onCreateChannel,
    onOpenMembers,
    onWelcomeAddAgent,
    projectHome,
  ]);
}
