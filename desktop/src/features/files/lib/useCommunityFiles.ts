import { useQuery } from "@tanstack/react-query";

import { useChannelsQuery } from "@/features/channels/hooks";
import { imetaMediaFromTags } from "@/features/messages/lib/imetaMediaMarkdown";
import { getChannelWindowEvents } from "@/shared/api/channelWindow";
import type { Channel } from "@/shared/api/types";

/** A file shared in one of this community's channels. */
export type CommunityFile = {
  key: string;
  url: string;
  type: string;
  name: string;
  size: number;
  thumb?: string;
  channelId: string;
  channelName: string;
  eventId: string;
  authorPubkey: string;
  createdAt: number;
};

export type FileKind = "image" | "video" | "audio" | "document";

export function fileKind(file: Pick<CommunityFile, "type">): FileKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

/** How many of the most recently active channels are looked through, and how
 *  far back in each. */
const CHANNELS = 15;
const MESSAGES_PER_CHANNEL = 150;

function fileName(url: string, filename: string | undefined): string {
  if (filename) return filename;
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

async function collectFiles(channels: Channel[]): Promise<CommunityFile[]> {
  const files: CommunityFile[] = [];
  const seen = new Set<string>();
  await Promise.all(
    channels.map(async (channel) => {
      const events = await getChannelWindowEvents(
        channel.id,
        null,
        MESSAGES_PER_CHANNEL,
      ).catch(() => []);
      for (const event of events) {
        for (const media of imetaMediaFromTags(event.tags)) {
          const key = `${event.id}:${media.url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          files.push({
            key,
            url: media.url,
            type: media.type,
            name: fileName(media.url, media.filename),
            size: media.size,
            thumb: media.thumb,
            channelId: channel.id,
            channelName: channel.name,
            eventId: event.id,
            authorPubkey: event.pubkey,
            createdAt: event.created_at,
          });
        }
      }
    }),
  );
  return files.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The files shared in this community's channels (the ones you're in, most
 * recently active first), newest first. Read from the channels' recent
 * messages, so very old files may not show.
 */
export function useCommunityFiles() {
  const { data: channels } = useChannelsQuery();
  const searched = (channels ?? [])
    .filter((c) => c.channelType !== "dm" && !c.archivedAt && c.isMember)
    .sort((a, b) =>
      String(b.lastMessageAt ?? "").localeCompare(
        String(a.lastMessageAt ?? ""),
      ),
    )
    .slice(0, CHANNELS);
  return useQuery({
    queryKey: ["community-files", searched.map((c) => c.id).join(",")],
    queryFn: () => collectFiles(searched),
    enabled: searched.length > 0,
    staleTime: 2 * 60_000,
  });
}
