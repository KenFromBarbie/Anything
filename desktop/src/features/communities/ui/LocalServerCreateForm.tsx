import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Loader2, Plus, Trash2 } from "lucide-react";

import {
  draftPlan,
  type ServerPlan,
  startingPrompt,
} from "@/features/communities/lib/serverPlan";
import { savePendingSetup } from "@/features/communities/lib/serverSetup";
import { callOffice } from "@/features/office/lib/officeLink";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

/**
 * A new server on this computer, set up for its work: first what it's for,
 * then the drafted setup (agents and their roles, channels, starter threads,
 * the work folder, Michael's starting prompt) to edit. Creating it starts its
 * relay (`local_servers.rs`), connects to it, and the setup is carried out
 * there (`serverSetup`).
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

  const toPlan = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setPlan(draftPlan(name.trim(), purpose.trim()));
    setPromptEdited(false);
    setStep("plan");
  };

  const chooseFolder = async () => {
    try {
      const picked = await callOffice<string | null>("hire.chooseFolder");
      if (picked) {
        setFolder(picked);
        edit((p) => ({ ...p, files: [picked] }));
      }
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
      const finalPlan = {
        ...plan,
        files: plan.files.length > 0 ? plan.files : [workFolder],
      };
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
        className="grid gap-3"
        data-testid="local-server-create"
        onSubmit={toPlan}
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
            placeholder="What you're making or running, who it's for, and how work should flow. The setup (agents, channels, Michael's first instructions) is drafted from this."
            value={purpose}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={!name.trim()} type="submit">
            Next: the setup
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div
      className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1"
      data-testid="local-server-plan"
    >
      <Section
        onAdd={() =>
          edit((p) => ({ ...p, agents: [...p.agents, { name: "", role: "" }] }))
        }
        title="Agents to hire"
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

      <div className="grid gap-1.5">
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
          The agents work here, and Michael starts by reading any files you put
          in it.
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
    <div className="grid gap-1.5">
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
    <div className="flex items-center gap-1.5">
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
