import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  isOfficeAgent,
  isOfficeWorker,
} from "@/features/agents/lib/managedAgentControlActions";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import {
  useChannelMessagesQuery,
  useChannelSubscription,
} from "@/features/messages/hooks";
import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { useIdentityQuery } from "@/shared/api/hooks";
import { listManagedAgents, sendChannelMessage } from "@/shared/api/tauri";
import type { Channel } from "@/shared/api/types";
import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import { Textarea } from "@/shared/ui/textarea";

import { QueueComposer } from "./QueueComposer";

/** The Buzz identity of an agent on the floor (each one gets one), if it has
 *  been made yet. */
function useAgentPubkey(agent: OfficeAgent) {
  return useQuery({
    queryKey: ["office", "agent-pubkey", agent.id],
    queryFn: async () => {
      const managed = await listManagedAgents();
      const match = managed.find((m) =>
        agent.isGod
          ? // Michael: the Office's own agent (no floor id of its own).
            isOfficeAgent(m) && !isOfficeWorker(m)
          : m.backend.type === "provider" &&
            m.backend.id === "office" &&
            m.backend.config?.officeAgentId === agent.id,
      );
      return match?.pubkey ?? null;
    },
    staleTime: 60_000,
  });
}

/** The existing direct-message channel with an agent, if there is one.
 *  Looking at an agent never creates one; the first message does. */
function useAgentDm(pubkey: string | null, myPubkey: string | undefined) {
  const { data: channels, isLoading } = useChannelsQuery();
  const channel = React.useMemo(
    () =>
      pubkey
        ? (channels?.find(
            (c) =>
              c.channelType === "dm" &&
              !c.archivedAt &&
              c.participantPubkeys.includes(pubkey) &&
              c.participantPubkeys.every((p) => p === pubkey || p === myPubkey),
          ) ?? null)
        : null,
    [channels, pubkey, myPubkey],
  );
  return { channel, isLoading };
}

function time(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Chatting with one of the floor's agents from the Agents page: their direct
 * messages with you, inline. Replies come back here as the agent answers.
 * Before an agent has its Buzz identity, messages go into its terminal queue.
 */
export function AgentChat({ agent }: { agent: OfficeAgent }) {
  const { data: pubkey, isLoading } = useAgentPubkey(agent);
  const { data: identity } = useIdentityQuery();
  const dm = useAgentDm(pubkey ?? null, identity?.pubkey);

  if (isLoading || (pubkey && dm.isLoading)) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Opening the chat…
      </div>
    );
  }
  if (!pubkey) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          {agent.name} doesn't have a Kenn’s Harness chat yet; messages go
          straight into their terminal.
        </p>
        <QueueComposer agent={agent} />
      </div>
    );
  }
  if (!dm.channel) {
    return <NewDmChat agent={agent} pubkey={pubkey} />;
  }
  return <DmChat agent={agent} channel={dm.channel} pubkey={pubkey} />;
}

/** No conversation yet: the first message opens the direct-message channel. */
function NewDmChat({ agent, pubkey }: { agent: OfficeAgent; pubkey: string }) {
  const openDmMutation = useOpenDmMutation();
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const channel = await openDmMutation.mutateAsync({ pubkeys: [pubkey] });
      await sendChannelMessage(channel.id, content, null, undefined, [pubkey]);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-2" data-testid="agent-chat">
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-border/70 bg-muted/20 p-3">
        <p className="text-sm text-muted-foreground">
          No messages with {agent.name} yet. Say hello, or give them something
          to do.
        </p>
      </div>
      <Composer
        agent={agent}
        onChange={setText}
        onSend={() => void send()}
        sending={sending}
        text={text}
      />
    </div>
  );
}

function Composer({
  agent,
  onChange,
  onSend,
  sending,
  text,
}: {
  agent: OfficeAgent;
  onChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  text: string;
}) {
  return (
    <div className="flex items-end gap-2">
      <Textarea
        className="min-h-10 flex-1 resize-none"
        data-testid="agent-chat-input"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={`Message ${agent.name}`}
        rows={1}
        value={text}
      />
      <Button
        aria-label="Send"
        disabled={!text.trim() || sending}
        onClick={onSend}
        size="icon"
      >
        {sending ? <Loader2 className="animate-spin" /> : <Send />}
      </Button>
    </div>
  );
}

function DmChat({
  agent,
  channel,
  pubkey,
}: {
  agent: OfficeAgent;
  channel: Channel;
  pubkey: string;
}) {
  useChannelSubscription(channel);
  const { data: events = [], isLoading } = useChannelMessagesQuery(channel);
  const { data: identity } = useIdentityQuery();
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);

  const messages = React.useMemo(
    () =>
      events
        .filter((e) => e.kind === KIND_STREAM_MESSAGE && e.content.trim())
        .sort((a, b) => a.created_at - b.created_at)
        .slice(-40),
    [events],
  );

  React.useEffect(() => {
    const el = scroller.current;
    if (el && messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await sendChannelMessage(channel.id, content, null, undefined, [pubkey]);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-2" data-testid="agent-chat">
      <div
        className="flex max-h-80 min-h-40 flex-col gap-2 overflow-y-auto rounded-xl border border-border/70 bg-muted/20 p-3"
        ref={scroller}
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">
            No messages with {agent.name} yet. Say hello, or give them something
            to do.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.pubkey === identity?.pubkey;
            return (
              <div
                className={cn(
                  "flex max-w-[85%] flex-col gap-0.5",
                  mine ? "self-end items-end" : "self-start",
                )}
                key={message.localKey ?? message.id}
              >
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm",
                    mine
                      ? "bg-primary text-primary-foreground"
                      : "bg-background shadow-sm",
                    message.pending && "opacity-60",
                  )}
                >
                  <Markdown content={message.content} />
                </div>
                <span className="px-1 text-[11px] text-muted-foreground">
                  {mine ? "You" : agent.name} · {time(message.created_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
      <Composer
        agent={agent}
        onChange={setText}
        onSend={() => void send()}
        sending={sending}
        text={text}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Enter to send, Shift+Enter for a new line.</span>
        <button
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => {
            window.location.hash = `#/channels/${channel.id}`;
          }}
          type="button"
        >
          <ExternalLink className="h-3 w-3" />
          Open in Messages
        </button>
      </div>
    </div>
  );
}
