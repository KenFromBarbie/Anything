import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Download, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import {
  githubRepoUrl,
  installSkillRequest,
} from "@/features/office/lib/skillInstall";
import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

/**
 * Settings → Memory & skills: what applies on every server. Notes here are
 * read by every server's agents (each Office mirrors them into its vault);
 * skills installed here go to the engines' user skills folders. The Agents
 * page's Memory & skills tab is the same for one server only.
 */
export function MemorySkillsSettingsCard() {
  return (
    <div className="grid gap-6" data-testid="settings-memory-skills">
      <GlobalMemoryCard />
      <GlobalSkillsCard />
    </div>
  );
}

function GlobalMemoryCard() {
  const memory = useQuery({
    queryKey: ["global-memory"],
    queryFn: () => invoke<string>("global_memory_get"),
    enabled: isTauri(),
  });
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? memory.data ?? "";
  const save = useMutation({
    mutationFn: (value: string) => invoke("global_memory_set", { text: value }),
    onSuccess: () => {
      setDraft(null);
      void memory.refetch();
      toast.success("Saved for every server's agents.");
    },
    onError: (error) => toast.error(String(error)),
  });
  return (
    <section className="grid gap-3 rounded-2xl border border-border/70 bg-card/40 p-5">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Notes for every server</h2>
        <p className="text-sm text-muted-foreground">
          What every agent on every server should know: who you are, how you
          like things done, standing rules. Each server's own memory stays on
          its Agents page.
        </p>
      </div>
      <Textarea
        className="min-h-48 font-mono text-sm"
        data-testid="global-memory"
        disabled={memory.isLoading}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="e.g. I'm a student at Wittenborg; keep answers short; never send anything on my behalf without asking."
        value={text}
      />
      <div>
        <Button
          data-testid="global-memory-save"
          disabled={draft === null || save.isPending}
          onClick={() => save.mutate(text)}
          size="sm"
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
    </section>
  );
}

function GlobalSkillsCard() {
  const { agents } = useOfficeAgents();
  const michael = agents.find((agent) => agent.isGod);
  const [repo, setRepo] = React.useState("");
  const url = githubRepoUrl(repo);
  const install = useMutation({
    mutationFn: (repoUrl: string) =>
      callOffice<boolean>("agent.message", {
        id: michael?.id ?? "god",
        text: installSkillRequest(repoUrl, { kind: "global" }),
      }),
    onSuccess: (_result, repoUrl) => {
      setRepo("");
      toast(
        `${michael?.name ?? "Michael"} is installing ${repoUrl} for every server.`,
      );
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <section className="grid gap-3 rounded-2xl border border-border/70 bg-card/40 p-5">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Skills for every server</h2>
        <p className="text-sm text-muted-foreground">
          Paste a GitHub repository with skills in it. Michael reviews it and
          installs its skills for the agents of every server. For one server
          only, use its Agents page → Memory &amp; skills.
        </p>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (url) install.mutate(url);
        }}
      >
        <Input
          aria-label="GitHub repository"
          className="min-w-64 flex-1"
          data-testid="global-skill-repo"
          onChange={(event) => setRepo(event.target.value)}
          placeholder="github.com/owner/repo"
          value={repo}
        />
        <Button disabled={!url || install.isPending} type="submit">
          {install.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download />
          )}
          Install
        </Button>
      </form>
      {repo.trim() && !url ? (
        <p className="text-xs text-muted-foreground">
          That doesn't look like a GitHub repository (owner/repo).
        </p>
      ) : null}
      {!michael ? (
        <p className="text-xs text-muted-foreground">
          Michael is asked through this server's Office, which starts when you
          open Agents or the Office.
        </p>
      ) : null}
    </section>
  );
}
