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
    setLinks((current) => (current.includes(url) ? current : [...current, url]));
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
      setPlan(planFromDraft(name.trim(), purpose.trim(), draft, files, pending));
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
      className="grid max-h-[70vh] min-w-0 gap-4 overflow-x-hidden overflow-y-auto pr-1"
      data-testid="local-server-plan"
    >
      {planNote ? (
        <p className="text-xs text-muted-foreground">{planNote}</p>
      ) : null}
      <Section
        hint="Permanent roles, each with an office of their own. They split up Michael's requests and hire floor workers as the work needs."
        onAdd={() =>
          edit((p) => ({ ...p, agents: [...p.agents, { name: "", role: "" }] }))
        }
        title="Permanent staff"
      >
        {plan.agents.map((agent, index) => (
          <Row
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
            key={index}
            onRemove={() =>
              edit((p) => ({
                ...p,
                agents: p.agents.filter((_, i) => i !== index),
              }))
            }
          >
            <Input
              className="h-8 w-28 shrink-0"
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
            <Input
              className="h-8"
              onChange={(event) =>
                edit((p) => ({
                  ...p,
                  agents: p.agents.map((a, i) =>
                    i === index ? { ...a, role: event.target.value } : a,
                  ),
                }))
              }
              placeholder="Role: what they do"
              value={agent.role}
            />
          </Row>
        ))}
      </Section>

      <Section
        onAdd={() =>
          edit((p) => ({
            ...p,
            channels: [...p.channels, { name: "", purpose: "" }],
          }))
        }
        title="Channels"
      >
        {plan.channels.map((channel, index) => (
          <Row
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
            key={index}
            onRemove={() =>
              edit((p) => ({
                ...p,
                channels: p.channels.filter((_, i) => i !== index),
              }))
            }
          >
            <Input
              className="h-8 w-32 shrink-0"
              onChange={(event) =>
                edit((p) => ({
                  ...p,
                  channels: p.channels.map((c, i) =>
                    i === index ? { ...c, name: event.target.value } : c,
                  ),
                }))
              }
              placeholder="name"
              value={channel.name}
            />
            <Input
              className="h-8"
              onChange={(event) =>
                edit((p) => ({
                  ...p,
                  channels: p.channels.map((c, i) =>
                    i === index ? { ...c, purpose: event.target.value } : c,
                  ),
                }))
              }
              placeholder="What it's for"
              value={channel.purpose}
            />
          </Row>
        ))}
      </Section>

      <Section
        hint="Optional: a first post in a channel, to start a thread."
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
        {plan.threads.map((thread, index) => (
          <Row
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
            key={index}
            onRemove={() =>
              edit((p) => ({
                ...p,
                threads: p.threads.filter((_, i) => i !== index),
              }))
            }
          >
            <select
              aria-label="Channel"
              className="h-8 w-32 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
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
            <Input
              className="h-8"
              onChange={(event) =>
                edit((p) => ({
                  ...p,
                  threads: p.threads.map((t, i) =>
                    i === index ? { ...t, title: event.target.value } : t,
                  ),
                }))
              }
              placeholder="Thread title"
              value={thread.title}
            />
          </Row>
        ))}
      </Section>

      <div className="grid min-w-0 gap-1.5">
        <span className="text-sm font-medium">Work folder and files</span>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void chooseFolder()}
            size="sm"
            type="button"
            variant="outline"
          >
            <FolderOpen />
            {folder ? "Change folder" : "Choose a folder"}
          </Button>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {folder ??
              `None chosen: a new folder, ~/Anything/${plan.name}, is made.`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The agents work here.{" "}
          {plan.files.length > 0
            ? `Your ${plan.files.length} attached file${plan.files.length === 1 ? " is" : "s are"} copied into its inputs folder.`
            : "Michael starts by reading any files you put in it."}
        </p>
      </div>

      <label
        className="grid gap-1.5 text-sm font-medium"
        htmlFor="server-prompt"
      >
        Michael's starting prompt
        <Textarea
          className="min-h-36 font-mono text-xs"
          id="server-prompt"
          onChange={(event) => {
            setPromptEdited(true);
            setPlan((p) => (p ? { ...p, prompt: event.target.value } : p));
          }}
          value={plan.prompt}
        />
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-between gap-2">
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

function Section({
  children,
  hint,
  onAdd,
  title,
}: {
  children: React.ReactNode;
  hint?: string;
  onAdd: () => void;
  title: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Button onClick={onAdd} size="xs" type="button" variant="ghost">
          <Plus />
          Add
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function Row({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 [&>input]:min-w-0">
      {children}
      <Button
        aria-label="Remove"
        onClick={onRemove}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Trash2 />
      </Button>
    </div>
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
