import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Loader2,
  Network,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import {
  type Codebase,
  codebaseIssueRequest,
  codebaseLeadRequest,
  codebasePrReviewRequest,
  codebaseRequest,
  codebaseTriageRequest,
} from "@/features/office/lib/studioRequests";
import {
  buildCodebaseGraph,
  CODEBASES_KEY,
  codebaseKey,
  openCodebaseGraph,
  saveCodebaseMemory,
  setCodebaseManaged,
  useCodebaseGit,
  useCodebaseGithub,
  useCodebaseGraph,
  useCodebaseMemory,
} from "@/features/office/lib/studioStore";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Textarea } from "@/shared/ui/textarea";

function ago(at?: number | string): string {
  if (!at) return "";
  const ms = typeof at === "string" ? Date.parse(at) : at;
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Sends the owner's codebase work to the CEO, who runs it down the office. */
function useTellCeo() {
  const { agents } = useOfficeAgents();
  const ceo = agents.find((agent) => agent.isGod);
  const send = useMutation({
    mutationFn: (text: string) =>
      callOffice<boolean>("agent.message", { id: ceo?.id ?? "god", text }),
    onError: (error) => toast.error(error.message),
  });
  return { ceoName: ceo?.name ?? "CEO", send };
}

/**
 * A linked codebase as a place to build and run app development: where it
 * stands in git, its GitHub issues and pull requests, the Office's memory of
 * it, and graphify's map of its code. Work goes to the CEO, who hands it to
 * the executive leading the codebase.
 */
export function CodebaseWorkspace({
  codebase,
  open,
  onOpenChange,
}: {
  codebase: Codebase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = React.useState("overview");
  const client = useQueryClient();
  const { ceoName, send } = useTellCeo();
  const isGithub = codebase.source === "github" || Boolean(codebase.url);

  const lead = useMutation({
    mutationFn: async (managed: boolean) => {
      await setCodebaseManaged(codebase.id, managed);
      if (managed) await send.mutateAsync(codebaseLeadRequest(codebase));
    },
    onSuccess: (_, managed) => {
      void client.invalidateQueries({ queryKey: CODEBASES_KEY });
      toast(
        managed
          ? `${ceoName} is picking an executive to lead ${codebase.name}.`
          : `The Office no longer leads ${codebase.name}.`,
        managed
          ? { description: "A health report comes to you in chat first." }
          : undefined,
      );
    },
    onError: (error) => toast.error(String(error)),
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[min(760px,90vh)] flex-col gap-3 sm:max-w-3xl"
        data-testid="codebase-workspace"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {codebase.name}
            {codebase.managed ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-3 w-3" />
                The Office leads it
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="truncate" title={codebase.path}>
            {codebase.path}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={setTab}
          value={tab}
        >
          <TabsList className="self-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {isGithub ? <TabsTrigger value="github">GitHub</TabsTrigger> : null}
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="graph">Code map</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto pt-3">
            <TabsContent className="mt-0" value="overview">
              <Overview
                codebase={codebase}
                lead={() => lead.mutate(!codebase.managed)}
                leadPending={lead.isPending}
                open={open}
                send={send}
              />
            </TabsContent>
            {isGithub ? (
              <TabsContent className="mt-0" value="github">
                <Github codebase={codebase} open={open && tab === "github"} send={send} />
              </TabsContent>
            ) : null}
            <TabsContent className="mt-0" value="memory">
              <Memory codebase={codebase} open={open && tab === "memory"} />
            </TabsContent>
            <TabsContent className="mt-0" value="graph">
              <Graph codebase={codebase} open={open && tab === "graph"} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

type Send = ReturnType<typeof useTellCeo>["send"];

function Overview({
  codebase,
  open,
  send,
  lead,
  leadPending,
}: {
  codebase: Codebase;
  open: boolean;
  send: Send;
  lead: () => void;
  leadPending: boolean;
}) {
  const client = useQueryClient();
  const { data: git, isFetching } = useCodebaseGit(codebase.id, open);
  const [ask, setAsk] = React.useState("");
  const [draftPr, setDraftPr] = React.useState(false);
  const isGithub = codebase.source === "github" || Boolean(codebase.url);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ask.trim()) return;
          send.mutate(codebaseRequest(codebase, ask, { draftPr }), {
            onSuccess: () => {
              setAsk("");
              toast("The CEO is on it.", {
                description: codebase.git
                  ? "It's built on a branch of its own; you get a summary in chat."
                  : "You get a summary in chat.",
              });
            },
          });
        }}
      >
        <span className="text-sm font-medium">What should the Office build?</span>
        <Textarea
          className="min-h-20 resize-y text-sm"
          onChange={(event) => setAsk(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Add sign-in with email links, with tests…"
          value={ask}
        />
        <div className="flex items-center gap-3">
          {isGithub && codebase.git ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={draftPr}
                onCheckedChange={(v) => setDraftPr(v === true)}
              />
              Open a draft pull request when it's done
            </label>
          ) : null}
          <Button
            className="ml-auto"
            disabled={!ask.trim() || send.isPending}
            size="sm"
            type="submit"
          >
            {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Send to the Office
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button disabled={leadPending} onClick={lead} size="sm" variant="outline">
          {leadPending ? <Loader2 className="animate-spin" /> : <Users />}
          {codebase.managed ? "Stop the Office leading it" : "Have the Office lead it"}
        </Button>
        <Button
          onClick={() =>
            void client.invalidateQueries({ queryKey: codebaseKey(codebase.id, "git") })
          }
          size="sm"
          variant="ghost"
        >
          <RefreshCw className={isFetching ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {!git ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading it…
        </p>
      ) : !git.git ? (
        <p className="text-sm text-muted-foreground">
          This folder isn't a git checkout, so there's no history or branches.
          Agents keep a copy of anything they change.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" /> {git.branch}
            </h4>
            <p className="text-sm">
              {git.changedCount
                ? `${git.changedCount} changed file${git.changedCount === 1 ? "" : "s"}`
                : "No uncommitted changes"}
              {git.upstream
                ? ` · ${git.ahead} ahead, ${git.behind} behind ${git.upstream}`
                : ""}
            </p>
            {git.changed.length ? (
              <ul className="max-h-28 overflow-y-auto rounded-md bg-muted/40 p-2 font-mono text-xs">
                {git.changed.map((c) => (
                  <li className="truncate" key={c.path} title={c.path}>
                    <span className="inline-block w-6 text-muted-foreground">{c.status}</span>
                    {c.path}
                  </li>
                ))}
              </ul>
            ) : null}
            <h4 className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Branches
            </h4>
            <ul className="flex flex-col gap-1 text-sm">
              {git.branches.map((b) => (
                <li className="flex items-center gap-2" key={b.name}>
                  <GitBranch
                    className={`h-3.5 w-3.5 ${b.current ? "text-emerald-500" : "text-muted-foreground"}`}
                  />
                  <span className={`truncate ${b.name.startsWith("anything/") ? "font-medium" : ""}`}>
                    {b.name}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{ago(b.at)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <GitCommitHorizontal className="h-3.5 w-3.5" /> Recent commits
            </h4>
            <ul className="flex flex-col gap-1.5 text-sm">
              {git.commits.map((c) => (
                <li className="flex min-w-0 flex-col" key={c.sha}>
                  <span className="truncate" title={c.subject}>{c.subject}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="font-mono">{c.sha}</span> · {c.author} · {ago(c.at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function Github({
  codebase,
  open,
  send,
}: {
  codebase: Codebase;
  open: boolean;
  send: Send;
}) {
  const client = useQueryClient();
  const { data, error, isFetching } = useCodebaseGithub(codebase.id, open);
  const [draftPr, setDraftPr] = React.useState(false);
  const sent = (what: string) =>
    toast(`Sent to the Office: ${what}.`, {
      description: "The result comes back to you in chat.",
    });

  if (error) {
    return <p className="text-sm text-destructive">{String(error)}</p>;
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Asking GitHub…
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void openUrl(`https://github.com/${data.repo}`)}
          size="sm"
          variant="ghost"
        >
          <ExternalLink /> {data.repo}
        </Button>
        <Button
          disabled={send.isPending || !data.issues.length}
          onClick={() =>
            send.mutate(codebaseTriageRequest(codebase), {
              onSuccess: () => sent("triage the open issues"),
            })
          }
          size="sm"
          variant="outline"
        >
          <Brain /> Triage the issues
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={draftPr} onCheckedChange={(v) => setDraftPr(v === true)} />
          Fixes open a draft pull request
        </label>
        <Button
          className="ml-auto"
          onClick={() =>
            void client.invalidateQueries({ queryKey: codebaseKey(codebase.id, "github") })
          }
          size="sm"
          variant="ghost"
        >
          <RefreshCw className={isFetching ? "animate-spin" : undefined} /> Refresh
        </Button>
      </div>

      <section className="flex flex-col gap-1">
        <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <GitPullRequest className="h-3.5 w-3.5" /> Pull requests ({data.prs.length})
        </h4>
        {data.prs.length ? null : <p className="text-sm text-muted-foreground">None open.</p>}
        {data.prs.map((pr) => (
          <Row
            action="Review"
            key={pr.number}
            meta={`${pr.headRefName} · ${pr.author?.login ?? ""} · ${ago(pr.updatedAt)}${pr.isDraft ? " · draft" : ""}${pr.reviewDecision ? ` · ${pr.reviewDecision.toLowerCase().replace(/_/g, " ")}` : ""}`}
            number={pr.number}
            onAction={() =>
              send.mutate(codebasePrReviewRequest(codebase, pr), {
                onSuccess: () => sent(`review #${pr.number}`),
              })
            }
            pending={send.isPending}
            title={pr.title}
            url={pr.url}
          />
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <CircleDot className="h-3.5 w-3.5" /> Issues ({data.issues.length})
        </h4>
        {data.issues.length ? null : <p className="text-sm text-muted-foreground">None open.</p>}
        {data.issues.map((issue) => (
          <Row
            action="Fix"
            key={issue.number}
            labels={issue.labels?.map((l) => l.name)}
            meta={`${issue.author?.login ?? ""} · ${ago(issue.updatedAt)}${issue.comments?.length ? ` · ${issue.comments.length} comments` : ""}`}
            number={issue.number}
            onAction={() =>
              send.mutate(codebaseIssueRequest(codebase, issue, { draftPr }), {
                onSuccess: () => sent(`fix #${issue.number}`),
              })
            }
            pending={send.isPending}
            title={issue.title}
            url={issue.url}
          />
        ))}
      </section>
    </div>
  );
}

function Row({
  number,
  title,
  meta,
  url,
  labels,
  action,
  onAction,
  pending,
}: {
  number: number;
  title: string;
  meta: string;
  url: string;
  labels?: string[];
  action: string;
  onAction: () => void;
  pending: boolean;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">#{number}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          className="truncate text-left text-sm hover:underline"
          onClick={() => void openUrl(url)}
          title={title}
          type="button"
        >
          {title}
        </button>
        <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {labels?.map((l) => (
            <span className="rounded bg-muted px-1.5" key={l}>{l}</span>
          ))}
          {meta}
        </span>
      </div>
      <Button
        className="opacity-70 group-hover:opacity-100"
        disabled={pending}
        onClick={onAction}
        size="sm"
        variant="outline"
      >
        {action}
      </Button>
    </div>
  );
}

function Memory({ codebase, open }: { codebase: Codebase; open: boolean }) {
  const client = useQueryClient();
  const { data } = useCodebaseMemory(codebase.id, open);
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (data && text === null) setText(data.text);
  }, [data, text]);
  React.useEffect(() => {
    if (!open) setText(null);
  }, [open]);
  const save = useMutation({
    mutationFn: () => saveCodebaseMemory(codebase.id, text ?? ""),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: codebaseKey(codebase.id, "memory") });
      toast("Saved. Agents read it before working in this codebase.");
    },
    onError: (error) => toast.error(String(error)),
  });
  if (!data || text === null) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  const dirty = text !== data.text;
  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        What the Office knows about {codebase.name}: agents read it before they
        start and add what they learn when they finish. Edit it to steer them.
      </p>
      <Textarea
        className="min-h-[380px] flex-1 resize-none font-mono text-xs"
        onChange={(event) => setText(event.target.value)}
        value={text}
      />
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-muted-foreground" title={data.path}>
          {data.path}
        </span>
        <Button
          className="ml-auto"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
          size="sm"
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
    </div>
  );
}

function Graph({ codebase, open }: { codebase: Codebase; open: boolean }) {
  const client = useQueryClient();
  const { data } = useCodebaseGraph(codebase.id, open);
  const build = useMutation({
    mutationFn: () => buildCodebaseGraph(codebase.id),
    onSuccess: (graph) => {
      client.setQueryData(codebaseKey(codebase.id, "graph"), graph);
      void client.invalidateQueries({ queryKey: CODEBASES_KEY });
      if (graph.built) {
        toast(`Mapped ${codebase.name}: ${graph.nodes} parts, ${graph.edges} links.`);
      }
    },
    onError: (error) => toast.error(String(error)),
  });
  if (!data) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        graphify maps the code (files, functions, classes and how they connect)
        so agents find their way with a query instead of reading everything.
        It runs on this computer, without a model or keys.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={build.isPending} onClick={() => build.mutate()} size="sm">
          {build.isPending ? <Loader2 className="animate-spin" /> : <Network />}
          {data.built ? "Update the map" : "Map the code"}
        </Button>
        {data.built ? (
          <Button
            onClick={() =>
              void openCodebaseGraph(codebase.id).catch((e) => toast.error(String(e)))
            }
            size="sm"
            variant="outline"
          >
            <ExternalLink /> Open the map
          </Button>
        ) : null}
      </div>
      {build.isPending ? (
        <p className="text-xs text-muted-foreground">Mapping… a big codebase takes a minute.</p>
      ) : null}
      {data.built ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Parts", data.nodes],
              ["Links", data.edges],
              ["Areas", data.communities],
            ].map(([label, value]) => (
              <div className="rounded-lg border border-border/70 bg-card/40 p-2" key={label}>
                <div className="text-lg font-semibold tabular-nums">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Updated {ago(data.builtAt)}.</p>
          {data.summary ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
              {data.summary}
            </pre>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Not mapped yet.</p>
      )}
    </div>
  );
}
