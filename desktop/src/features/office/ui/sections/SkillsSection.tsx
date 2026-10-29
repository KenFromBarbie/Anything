import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { officeCth } from "@/features/office/lib/officeCth";
import {
  githubRepoUrl,
  installSkillRequest,
} from "@/features/office/lib/skillInstall";
import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { SegmentedControl } from "@/shared/ui/segmented-control";

import { Muted, SECTION_SELECT, SectionCard } from "./SectionBits";

type LocalSkill = {
  id: string;
  name: string;
  description: string;
  provider: "claude" | "opencode" | "codex";
  scope: "user" | "project" | "bundled";
  path: string;
};
type CatalogSkill = {
  name: string;
  description: string;
  url: string;
  category: string;
  owner: string;
};
type Catalog = {
  skills: CatalogSkill[];
  fetchedAt: number;
  stale: boolean;
  error?: string;
};

const PROVIDER_LABEL: Record<LocalSkill["provider"], string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
};

function countBy<T>(list: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of list)
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

/** Skills the agents can use: what's installed, and a catalog to add more. */
export function SkillsSection() {
  const client = useQueryClient();
  const { agents, selectedId } = useOfficeAgents();
  const cwd = agents.find((agent) => agent.id === selectedId)?.cwd;
  const [mode, setMode] = React.useState<"installed" | "browse">("installed");
  const [query, setQuery] = React.useState("");
  const [owner, setOwner] = React.useState("all");
  const [category, setCategory] = React.useState("all");
  const [removing, setRemoving] = React.useState<LocalSkill | null>(null);

  const localKey = ["office", "skills-local", cwd ?? ""];
  const local = useQuery({
    queryKey: localKey,
    queryFn: () => officeCth<LocalSkill[]>("skillsLocal", cwd),
  });
  const catalog = useQuery({
    queryKey: ["office", "skills-catalog"],
    queryFn: () => officeCth<Catalog>("skillsCatalog", false),
    enabled: mode === "browse",
    staleTime: 10 * 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => officeCth<Catalog>("skillsCatalog", true),
    onSuccess: (data) =>
      client.setQueryData(["office", "skills-catalog"], data),
  });
  const install = useMutation({
    mutationFn: (skill: CatalogSkill) =>
      officeCth<{ ok: boolean; error?: string; unsupported?: boolean }>(
        "skillsInstall",
        skill.url,
        skill.name,
      ),
    onSuccess: (result, skill) => {
      if (result.ok) {
        toast.success(`Installed ${skill.name}.`);
        void client.invalidateQueries({ queryKey: localKey });
      } else {
        toast.error(result.error ?? "Couldn't install that skill.");
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const uninstall = useMutation({
    mutationFn: (skill: LocalSkill) =>
      officeCth<{ ok: boolean; error?: string }>("skillsUninstall", skill.path),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error ?? "Couldn't remove it.");
      void client.invalidateQueries({ queryKey: localKey });
    },
    onError: (error) => toast.error(error.message),
  });

  // Add from GitHub: the owner gives the repo, Michael installs it.
  const michael = agents.find((agent) => agent.isGod);
  const [repo, setRepo] = React.useState("");
  const repoUrl = githubRepoUrl(repo);
  const addFromGitHub = useMutation({
    mutationFn: (url: string) =>
      callOffice<boolean>("agent.message", {
        id: michael?.id ?? "god",
        text: installSkillRequest(url, {
          kind: "server",
          // Where this server's agents work (Michael's hive included).
          folders: [
            ...new Set(agents.map((agent) => agent.cwd).filter(Boolean)),
          ],
        }),
      }),
    onSuccess: (_result, url) => {
      setRepo("");
      toast(`${michael?.name ?? "Michael"} is installing ${url}.`, {
        description: "It shows under Installed once it's in.",
      });
      // Pick it up when it lands, without a manual refresh.
      for (const ms of [60_000, 180_000, 420_000]) {
        setTimeout(
          () => void client.invalidateQueries({ queryKey: localKey }),
          ms,
        );
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const q = query.trim().toLowerCase();
  const matches = (s: { name: string; description: string }) =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q);
  const installed = (local.data ?? []).filter(matches);
  const all = catalog.data?.skills ?? [];
  const filtered = all.filter(
    (s) =>
      (owner === "all" || s.owner === owner) &&
      (category === "all" || s.category === category) &&
      matches(s),
  );

  return (
    <div className="grid gap-4" data-testid="section-skills">
      <SectionCard
        description="Paste a GitHub repository with skills in it. Michael reads it, installs its skills for this server's agents, and tells you what he added. To install for every server, use Settings → Memory & skills."
        title="Add from GitHub"
      >
        <form
          className="flex flex-wrap items-center gap-2"
          data-testid="skills-add-github"
          onSubmit={(event) => {
            event.preventDefault();
            if (repoUrl) addFromGitHub.mutate(repoUrl);
          }}
        >
          <Input
            aria-label="GitHub repository"
            className="min-w-64 flex-1"
            data-testid="skills-github-repo"
            onChange={(event) => setRepo(event.target.value)}
            placeholder="github.com/owner/repo"
            value={repo}
          />
          <Button
            data-testid="skills-github-install"
            disabled={!repoUrl || addFromGitHub.isPending}
            type="submit"
          >
            {addFromGitHub.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
            Install
          </Button>
        </form>
        {repo.trim() && !repoUrl ? (
          <Muted>
            That doesn't look like a GitHub repository (owner/repo).
          </Muted>
        ) : null}
      </SectionCard>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<"installed" | "browse">
          legend="Skills view"
          onValueChange={setMode}
          optionTestIdPrefix="skills-mode"
          options={[
            {
              value: "installed",
              label: `Installed${local.data ? ` · ${local.data.length}` : ""}`,
            },
            {
              value: "browse",
              label: `Browse${catalog.data ? ` · ${all.length}` : ""}`,
            },
          ]}
          testId="skills-mode"
          value={mode}
        />
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              mode === "installed"
                ? "Search installed skills"
                : "Search the catalog"
            }
            value={query}
          />
        </div>
        {mode === "browse" ? (
          <>
            <select
              aria-label="Publisher"
              className={SECTION_SELECT}
              onChange={(event) => setOwner(event.target.value)}
              value={owner}
            >
              <option value="all">All publishers</option>
              {countBy(all, (s) => s.owner).map(([name, n]) => (
                <option key={name} value={name}>
                  {name} ({n})
                </option>
              ))}
            </select>
            <select
              aria-label="Category"
              className={SECTION_SELECT}
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              <option value="all">All categories</option>
              {countBy(all, (s) => s.category).map(([name, n]) => (
                <option key={name} value={name}>
                  {name} ({n})
                </option>
              ))}
            </select>
            <Button
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
              size="sm"
              variant="outline"
            >
              {refresh.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Refresh
            </Button>
          </>
        ) : null}
      </div>

      {mode === "installed" ? (
        <SectionCard
          description="Skills the agents' engines load, for the whole machine or this project."
          title="Installed"
        >
          {local.isLoading ? (
            <Muted>Scanning…</Muted>
          ) : installed.length === 0 ? (
            <Muted>
              {(local.data ?? []).length === 0
                ? "No skills installed yet. Browse the catalog to add some."
                : "Nothing matches."}
            </Muted>
          ) : (
            <ul className="grid gap-2">
              {installed.map((skill) => (
                <li
                  className="grid gap-1 rounded-xl border border-border/70 px-3 py-2"
                  key={skill.path}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{skill.name}</span>
                    <Badge variant="outline">
                      {PROVIDER_LABEL[skill.provider]}
                    </Badge>
                    <Badge
                      variant={skill.scope === "project" ? "info" : "secondary"}
                    >
                      {skill.scope}
                    </Badge>
                    <span className="flex-1" />
                    <Button
                      onClick={() =>
                        void officeCth("skillsReveal", skill.path).catch(
                          (error: Error) => toast.error(error.message),
                        )
                      }
                      size="xs"
                      variant="ghost"
                    >
                      <FolderOpen />
                      Open folder
                    </Button>
                    {skill.scope === "bundled" ? (
                      <span className="text-xs text-muted-foreground">
                        Ships with the app
                      </span>
                    ) : (
                      <Button
                        disabled={
                          uninstall.isPending &&
                          uninstall.variables?.path === skill.path
                        }
                        onClick={() => setRemoving(skill)}
                        size="xs"
                        variant="ghost"
                      >
                        <Trash2 />
                        Uninstall
                      </Button>
                    )}
                  </div>
                  {skill.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {skill.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          description={
            catalog.data?.stale && catalog.data.error
              ? `Showing a cached copy: ${catalog.data.error}`
              : `${filtered.length} skill${filtered.length === 1 ? "" : "s"}${filtered.length > 300 ? " (first 300 shown)" : ""}.`
          }
          title="Catalog"
        >
          {catalog.isLoading ? (
            <Muted>Loading the catalog…</Muted>
          ) : filtered.length === 0 ? (
            <Muted>Nothing matches.</Muted>
          ) : (
            <ul className="grid gap-2">
              {filtered.slice(0, 300).map((skill) => (
                <li
                  className="grid gap-1 rounded-xl border border-border/70 px-3 py-2"
                  key={skill.url}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{skill.name}</span>
                    <Badge variant="outline">{skill.owner}</Badge>
                    <Badge variant="secondary">{skill.category}</Badge>
                    <span className="flex-1" />
                    <Button
                      onClick={() => void openUrl(skill.url)}
                      size="xs"
                      variant="ghost"
                    >
                      <ExternalLink />
                      Learn more
                    </Button>
                    <Button
                      disabled={
                        install.isPending &&
                        install.variables?.url === skill.url
                      }
                      onClick={() => install.mutate(skill)}
                      size="xs"
                      variant="outline"
                    >
                      {install.isPending &&
                      install.variables?.url === skill.url ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Download />
                      )}
                      Install
                    </Button>
                  </div>
                  {skill.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {skill.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        open={!!removing}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its folder is deleted from {removing?.path}. You can install it
              again from the catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) uninstall.mutate(removing);
              }}
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
