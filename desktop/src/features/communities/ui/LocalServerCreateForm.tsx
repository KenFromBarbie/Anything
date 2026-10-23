import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import {
  FolderOpen,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import {
  type DraftFromClaude,
  draftPlan,
  planFromDraft,
  type ServerPlan,
  startingPrompt,
} from "@/features/communities/lib/serverPlan";
import { savePendingSetup } from "@/features/communities/lib/serverSetup";
import { callOffice } from "@/features/office/lib/officeLink";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

/**
 * A new server on this computer, set up for its work: first what it's for
 * (with files and links to go on), then the setup Claude drafts from that
 * (`server_plan`: permanent staff, channels and starter threads specific to
 * the work, Michael's starting prompt) to edit. Creating it starts its relay
 * (`local_servers.rs`), connects to it, and the setup is carried out there
 * (`serverSetup`).
 */
export function LocalServerCreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (relayUrl: string, name: string) => void;
}) {
  const [step, setStep] = React.useState<"describe" | "plan">("describe");
  const [name, setName] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [plan, setPlan] = React.useState<ServerPlan | null>(null);
  const [promptEdited, setPromptEdited] = React.useState(false);
  const [folder, setFolder] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<string[]>([]);
  const [links, setLinks] = React.useState<string[]>([]);
  const [link, setLink] = React.useState("");
  const [planning, setPlanning] = React.useState(false);
  const [planNote, setPlanNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { data: available, isLoading } = useQuery({
    queryKey: ["local-servers-available"],
    queryFn: () => invoke<boolean>("local_servers_available"),
  });

  // The starting prompt follows the plan until it's edited by hand.
  const edit = (change: (p: ServerPlan) => ServerPlan) =>
    setPlan((current) => {
      if (!current) return current;
      const next = change(current);
      return promptEdited ? next : { ...next, prompt: startingPrompt(next) };
    });

  const addLink = () => {
    const value = link.trim();
    if (!value) return;
    const url = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
    setLinks((current) =>
      current.includes(url) ? current : [...current, url],
    );
    setLink("");
  };

  const attachFiles = async () => {
    try {
      const picked = await invoke<string[]>("server_pick_files");
      setFiles((current) => [
        ...current,
        ...picked.filter((f) => !current.includes(f)),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Claude drafts the setup from the description, files and links; if it
  // can't, a template stands in and the owner is told why.
  const toPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || planning) return;
    const pending = link.trim() ? [...links, link.trim()] : links;
    setPlanning(true);
    setPlanNote(null);
    setError(null);
    try {
      const draft = await invoke<DraftFromClaude>("server_plan", {
        name: name.trim(),
        purpose: purpose.trim(),
        files,
        links: pending,
      });
      setPlan(
        planFromDraft(name.trim(), purpose.trim(), draft, files, pending),
      );
    } catch (e) {
      setPlan(draftPlan(name.trim(), purpose.trim(), files, pending));
      setPlanNote(
        `Claude couldn't draft this one (${e instanceof Error ? e.message : String(e)}), so this is a general starting point. Edit it to fit.`,
      );
    } finally {
      setPlanning(false);
    }
    if (link.trim()) {
      setLinks(pending);
      setLink("");
    }
    setPromptEdited(false);
    setStep("plan");
  };

  const chooseFolder = async () => {
    try {
      const picked = await callOffice<string | null>("hire.chooseFolder");
      if (picked) setFolder(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const create = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      const workFolder =
        folder ??
        (await invoke<string>("server_work_folder", { name: plan.name }));
      // The attachments go into the work folder, where the agents work.
      const copies =
        plan.files.length > 0
          ? await invoke<string[]>("server_attach_files", {
              workFolder,
              files: plan.files,
            })
          : [];
      const finalPlan = { ...plan, files: copies, workFolder };
      const prompt = promptEdited
        ? finalPlan.prompt
        : startingPrompt(finalPlan);
      const created = await invoke<{ name: string; relayUrl: string }>(
        "local_server_create",
        { name: plan.name },
      );
      savePendingSetup({
        ...finalPlan,
        prompt,
        relayUrl: created.relayUrl,
        workFolder,
        done: {},
      });
      onCreated(created.relayUrl, created.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isLoading && available === false) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Servers on this computer need the local relay from the source
          checkout, which isn't set up here. You can still join a server you
          have the address of.
        </p>
        <div className="flex justify-end">
          <Button onClick={onCancel} variant="outline">
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (step === "describe" || !plan) {
    return (
      <form
        className="grid min-w-0 gap-3"
        data-testid="local-server-create"
        onSubmit={(event) => void toPlan(event)}
      >
        <label
          className="grid gap-1.5 text-sm font-medium"
          htmlFor="local-server-name"
        >
          Name
          <Input
            autoFocus
            id="local-server-name"
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Race Cafe"
            value={name}
          />
        </label>
        <label
          className="grid gap-1.5 text-sm font-medium"
          htmlFor="local-server-purpose"
        >
          What's the work?
          <Textarea
            className="min-h-28"
            id="local-server-purpose"
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="What you're making or running, who it's for, and how work should flow. The setup (staff, channels, Michael's first instructions) is drafted from this."
            value={purpose}
          />
        </label>
        <div className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              disabled={planning}
              onClick={() => void attachFiles()}
              size="sm"
              type="button"
              variant="outline"
            >
              <Paperclip />
              Attach files
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Input
                aria-label="Link"
                className="h-8 min-w-0"
                disabled={planning}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLink();
                  }
                }}
                placeholder="Add a link (a site, a doc, a brief)"
                value={link}
              />
              <Button
                aria-label="Add link"
                disabled={!link.trim() || planning}
                onClick={addLink}
                size="icon"
                type="button"
                variant="outline"
              >
                <Plus />
              </Button>
            </div>
          </div>
          {files.length + links.length > 0 ? (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {files.map((file) => (
                <Attachment
                  icon={<Paperclip className="size-3" />}
                  key={file}
                  label={file.split(/[\\/]/).pop() ?? file}
                  onRemove={() => setFiles((c) => c.filter((f) => f !== file))}
                  title={file}
                />
              ))}
              {links.map((url) => (
                <Attachment
                  icon={<Link2 className="size-3" />}
                  key={url}
                  label={url.replace(/^https?:\/\//, "")}
                  onRemove={() => setLinks((c) => c.filter((l) => l !== url))}
                  title={url}
                />
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Claude reads these to plan the setup, and the agents get them too.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={!name.trim() || planning} type="submit">
            {planning ? <Loader2 className="animate-spin" /> : null}
            {planning ? "Planning the setup…" : "Next: the setup"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div
      className="-mr-3 grid max-h-[68vh] min-w-0 gap-6 overflow-x-hidden overflow-y-auto pr-3 [scrollbar-width:thin]"
      data-testid="local-server-plan"
    >
      {planNote ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {planNote}
        </p>
      ) : null}

      <Section
        hint="Standing roles with an office each. They split up Michael's requests and hire floor workers."
        onAdd={() =>
          edit((p) => ({ ...p, agents: [...p.agents, { name: "", role: "" }] }))
        }
        title="Permanent staff"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {plan.agents.map((agent, index) => (
            <div
              className="group relative flex min-w-0 gap-3 rounded-xl border border-border/60 bg-muted/30 p-3"
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are edited in place
              key={index}
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{
                  background: `hsl(${(index * 67 + 205) % 360} 70% 50%)`,
                }}
              >
                {agent.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5 pr-5">
                <input
                  aria-label="Name"
                  className={`${GHOST_FIELD} text-sm font-medium`}
                  onChange={(event) =>
                    edit((p) => ({
                      ...p,
                      agents: p.agents.map((a, i) =>
                        i === index ? { ...a, name: event.target.value } : a,
                      ),
                    }))
                  }
                  placeholder="Name"
                  value={agent.name}
                />
                <textarea
                  aria-label="Role"
                  className={`${GHOST_FIELD} resize-none text-xs leading-relaxed text-muted-foreground [field-sizing:content]`}
                  onChange={(event) =>
                    edit((p) => ({
                      ...p,
                      agents: p.agents.map((a, i) =>
                        i === index ? { ...a, role: event.target.value } : a,
                      ),
                    }))
                  }
                  placeholder="Title: what they own"
                  rows={1}
                  value={agent.role}
                />
              </div>
              <RemoveButton
                label={`Remove ${agent.name || "this role"}`}
                onClick={() =>
                  edit((p) => ({
                    ...p,
                    agents: p.agents.filter((_, i) => i !== index),
                  }))
                }
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        hint="Named after this work's streams and deliverables."
        onAdd={() =>
          edit((p) => ({
            ...p,
            channels: [...p.channels, { name: "", purpose: "" }],
          }))
        }
        title="Channels"
      >
        <List>
          {plan.channels.map((channel, index) => (
            <ListRow
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
              key={index}
              onRemove={() =>
                edit((p) => ({
                  ...p,
                  channels: p.channels.filter((_, i) => i !== index),
                }))
              }
              removeLabel={`Remove #${channel.name || "channel"}`}
            >
              <div className="flex min-w-0 items-baseline sm:w-56 sm:shrink-0">
                <span className="pl-1.5 text-sm text-muted-foreground">#</span>
                <textarea
                  aria-label="Channel name"
                  className={`${GHOST_FIELD} resize-none break-all text-sm font-medium [field-sizing:content]`}
                  onChange={(event) =>
                    edit((p) => ({
                      ...p,
                      channels: p.channels.map((c, i) =>
                        i === index ? { ...c, name: event.target.value } : c,
                      ),
                    }))
                  }
                  placeholder="channel-name"
                  rows={1}
                  value={channel.name}
                />
              </div>
              <textarea
                aria-label="What it's for"
                className={`${GHOST_FIELD} flex-1 resize-none text-sm text-muted-foreground [field-sizing:content]`}
                onChange={(event) =>
                  edit((p) => ({
                    ...p,
                    channels: p.channels.map((c, i) =>
                      i === index ? { ...c, purpose: event.target.value } : c,
                    ),
                  }))
                }
                placeholder="What it's for"
                rows={1}
                value={channel.purpose}
              />
            </ListRow>
          ))}
        </List>
      </Section>

      <Section
        hint="Optional first posts that get the work going."
        onAdd={() =>
          edit((p) => ({
            ...p,
            threads: [
              ...p.threads,
              { channel: p.channels[0]?.name ?? "general", title: "" },
            ],
          }))
        }
        title="Starter threads"
      >
        <List>
          {plan.threads.map((thread, index) => (
            <ListRow
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
              key={index}
              onRemove={() =>
                edit((p) => ({
                  ...p,
                  threads: p.threads.filter((_, i) => i !== index),
                }))
              }
              removeLabel="Remove this thread"
            >
              <textarea
                aria-label="Thread"
                className={`${GHOST_FIELD} flex-1 resize-none text-sm [field-sizing:content]`}
                onChange={(event) =>
                  edit((p) => ({
                    ...p,
                    threads: p.threads.map((t, i) =>
                      i === index ? { ...t, title: event.target.value } : t,
                    ),
                  }))
                }
                placeholder="What the first post asks or sets out"
                rows={1}
                value={thread.title}
              />
              <select
                aria-label="Channel"
                className="h-7 max-w-full shrink-0 self-start truncate rounded-full border-0 bg-foreground/5 px-2.5 text-xs text-muted-foreground outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring sm:max-w-44"
                onChange={(event) =>
                  edit((p) => ({
                    ...p,
                    threads: p.threads.map((t, i) =>
                      i === index ? { ...t, channel: event.target.value } : t,
                    ),
                  }))
                }
                value={thread.channel}
              >
                {plan.channels.map((c) => (
                  <option key={c.name} value={c.name}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </ListRow>
          ))}
        </List>
      </Section>

      <Section title="Work folder">
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-sm" title={folder ?? undefined}>
              {folder ?? `~/Anything/${plan.name}`}
            </span>
            <span className="text-xs text-muted-foreground">
              {folder
                ? "The agents work here."
                : "Made for you; the agents work here."}
              {plan.files.length > 0
                ? ` Your ${plan.files.length} file${plan.files.length === 1 ? " goes" : "s go"} in its inputs folder.`
                : ""}
            </span>
          </div>
          <Button
            onClick={() => void chooseFolder()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {folder ? "Change" : "Choose…"}
          </Button>
        </div>
      </Section>

      <details className="group/prompt min-w-0 rounded-xl border border-border/60 bg-muted/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Michael's starting prompt
          <span className="text-xs font-normal text-muted-foreground group-open/prompt:hidden">
            {promptEdited ? "Edited" : "Written from the setup above"}
          </span>
        </summary>
        <Textarea
          className="min-h-48 rounded-none rounded-b-xl border-0 border-t border-border/60 bg-transparent font-mono text-xs leading-relaxed focus-visible:ring-0"
          id="server-prompt"
          onChange={(event) => {
            setPromptEdited(true);
            setPlan((p) => (p ? { ...p, prompt: event.target.value } : p));
          }}
          value={plan.prompt}
        />
      </details>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="sticky bottom-0 -mb-px flex justify-between gap-2 border-t border-border/60 bg-background pt-3">
        <Button
          disabled={busy}
          onClick={() => setStep("describe")}
          type="button"
          variant="ghost"
        >
          Back
        </Button>
        <Button disabled={busy} onClick={() => void create()} type="button">
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "Starting it…" : "Create server"}
        </Button>
      </div>
    </div>
  );
}

/** An inline field that reads as text until hovered or focused. */
const GHOST_FIELD =
  "w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-foreground/5 focus:border-input focus:bg-background";

function Section({
  children,
  hint,
  onAdd,
  title,
}: {
  children: React.ReactNode;
  hint?: string;
  onAdd?: () => void;
  title: string;
}) {
  return (
    <section className="grid min-w-0 gap-2.5">
      <div className="flex items-end justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint ? (
            <p className="text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {onAdd ? (
          <Button
            className="shrink-0"
            onClick={onAdd}
            size="xs"
            type="button"
            variant="ghost"
          >
            <Plus />
            Add
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-muted/30">
      {children}
    </div>
  );
}

function ListRow({
  children,
  onRemove,
  removeLabel,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="group relative flex min-w-0 flex-col gap-1 px-2 py-2 pr-9 sm:flex-row sm:items-start sm:gap-3">
      {children}
      <RemoveButton label={removeLabel} onClick={onRemove} />
    </div>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="absolute top-2 right-2 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground"
      onClick={onClick}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <Trash2 />
    </Button>
  );
}

function Attachment({
  icon,
  label,
  onRemove,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onRemove: () => void;
  title: string;
}) {
  return (
    <span
      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-border bg-muted/50 py-0.5 pr-0.5 pl-1.5 text-xs"
      title={title}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <Button
        aria-label={`Remove ${label}`}
        className="size-5"
        onClick={onRemove}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <X />
      </Button>
    </span>
  );
}
