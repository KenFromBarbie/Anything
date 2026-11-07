import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import {
  Brain,
  Check,
  Ellipsis,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { callOffice, useOfficeAgents } from "@/features/office/lib/officeLink";
import {
  type Codebase,
  codebaseLearnRequest,
  codebaseRequest,
} from "@/features/office/lib/studioRequests";
import {
  addCodebase,
  CODEBASES_KEY,
  openCodebase,
  pullCodebase,
  removeCodebase,
  useCodebases,
} from "@/features/office/lib/studioStore";
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
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

/**
 * Codebases, like Claude Design's: link a GitHub repo (cloned into the
 * Office) or a folder on this computer, and the agents make things in its
 * look with its parts, learn its design, or work in it.
 */
export function Codebases() {
  const { data: codebases = [] } = useCodebases();
  const [adding, setAdding] = React.useState(false);
  return (
    <section className="flex flex-col gap-3" data-testid="codebases">
      <div className="flex items-baseline gap-2">
        <SubsectionLabel>Codebases</SubsectionLabel>
        <span className="text-xs text-muted-foreground">
          Things made here can use their design and components, and agents can
          work in them.
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {codebases.map((codebase) => (
          <CodebaseCard codebase={codebase} key={codebase.id} />
        ))}
        <button
          className="flex min-h-24 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/70 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          data-testid="codebase-add"
          onClick={() => setAdding(true)}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Link a codebase
        </button>
      </div>
      <AddCodebaseDialog onOpenChange={setAdding} open={adding} />
    </section>
  );
}

function CodebaseCard({ codebase }: { codebase: Codebase }) {
  const client = useQueryClient();
  const { agents } = useOfficeAgents();
  const michael = agents.find((agent) => agent.isGod);
  const [asking, setAsking] = React.useState(false);
  const [ask, setAsk] = React.useState("");
  const [removing, setRemoving] = React.useState(false);
  const refresh = () =>
    void client.invalidateQueries({ queryKey: CODEBASES_KEY });

  const tell = useMutation({
    mutationFn: (text: string) =>
      callOffice<boolean>("agent.message", { id: michael?.id ?? "god", text }),
    onError: (error) => toast.error(error.message),
  });
  const pull = useMutation({
    mutationFn: () => pullCodebase(codebase.id),
    onSuccess: ({ said }) => {
      refresh();
      toast(`${codebase.name} is up to date.`, {
        description: said || undefined,
      });
    },
    onError: (error) => toast.error(`Couldn't update it: ${String(error)}`),
  });
  const remove = useMutation({
    mutationFn: () => removeCodebase(codebase.id),
    onSuccess: () => {
      refresh();
      toast(`Unlinked ${codebase.name}.`);
    },
    onError: (error) => toast.error(String(error)),
  });

  const Icon = codebase.source === "github" ? FolderGit2 : FolderOpen;
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-3"
      data-testid={`codebase-${codebase.id}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/60">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium" title={codebase.path}>
            {codebase.name}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {codebase.exists === false ? (
              <span className="text-destructive">Folder missing</span>
            ) : codebase.branch ? (
              <>
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{codebase.branch}</span>
              </>
            ) : (
              <span className="truncate">
                {codebase.source === "github" ? "GitHub" : "Folder"}
              </span>
            )}
            <span>·</span>
            {codebase.hasNotes ? (
              <span className="flex items-center gap-0.5">
                <Check className="h-3 w-3" />
                Design learned
              </span>
            ) : (
              <span>Design not learned yet</span>
            )}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`${codebase.name}: more`}
              className="h-7 w-7"
              size="icon"
              variant="ghost"
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                tell.mutate(codebaseLearnRequest(codebase), {
                  onSuccess: () =>
                    toast(
                      `${michael?.name ?? "CEO"} is learning ${codebase.name}'s design.`,
                      {
                        description:
                          "Things you make in its look will follow it.",
                      },
                    ),
                })
              }
            >
              <Brain />
              {codebase.hasNotes
                ? "Learn its design again"
                : "Learn its design"}
            </DropdownMenuItem>
            {codebase.git ? (
              <DropdownMenuItem
                disabled={pull.isPending}
                onSelect={() => pull.mutate()}
              >
                <RefreshCw />
                Get the latest
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={() =>
                void openCodebase(codebase.id).catch((e) =>
                  toast.error(String(e)),
                )
              }
            >
              <FolderOpen />
              Open the folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setRemoving(true)}
            >
              <Trash2 />
              Unlink
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {asking ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ask.trim()) return;
            tell.mutate(codebaseRequest(codebase, ask), {
              onSuccess: () => {
                setAsk("");
                setAsking(false);
                toast(`${michael?.name ?? "CEO"} is on it.`, {
                  description:
                    "The work goes on a branch of its own; you get a summary in chat.",
                });
              },
            });
          }}
        >
          <Textarea
            autoFocus
            className="min-h-16 flex-1 resize-y text-sm"
            onChange={(event) => setAsk(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAsking(false);
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Add a dark mode toggle to the header…"
            value={ask}
          />
          <Button
            aria-label="Send"
            disabled={!ask.trim() || tell.isPending}
            size="icon"
            type="submit"
          >
            {tell.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
      ) : (
        <Button
          className="self-start"
          disabled={codebase.exists === false}
          onClick={() => setAsking(true)}
          size="sm"
          variant="outline"
        >
          <MessageSquare />
          Ask an agent to work in it
        </Button>
      )}
      <AlertDialog onOpenChange={setRemoving} open={removing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink {codebase.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {codebase.source === "github"
                ? "The Office's copy of it goes to the Recycle Bin, with the agents' notes on its design. The repo on GitHub isn't touched."
                : "Your folder stays where it is, untouched. The agents' notes on its design go to the Recycle Bin."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddCodebaseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [repo, setRepo] = React.useState("");
  const add = useMutation({
    mutationFn: (source: string) => addCodebase(source),
    onSuccess: (codebase) => {
      void client.invalidateQueries({ queryKey: CODEBASES_KEY });
      setRepo("");
      onOpenChange(false);
      toast(`Linked ${codebase.name}.`, {
        description: "Learn its design (⋯) so what's made here matches it.",
      });
    },
    onError: (error) => toast.error(String(error)),
  });
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" data-testid="codebase-add-dialog">
        <DialogHeader>
          <DialogTitle>Link a codebase</DialogTitle>
          <DialogDescription>
            A GitHub repo is copied into this server's Office; a folder on this
            computer is used where it is.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (repo.trim()) add.mutate(repo.trim());
          }}
        >
          <Input
            autoFocus
            data-testid="codebase-repo"
            onChange={(event) => setRepo(event.target.value)}
            placeholder="owner/repo or its github.com address"
            value={repo}
          />
          <Button disabled={!repo.trim() || add.isPending} type="submit">
            {add.isPending ? <Loader2 className="animate-spin" /> : null}
            Link
          </Button>
        </form>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button
          disabled={add.isPending}
          onClick={async () => {
            const folder = await pickFolder({
              directory: true,
              title: "Link a codebase",
            });
            if (typeof folder === "string") add.mutate(folder);
          }}
          variant="outline"
        >
          <FolderOpen />
          Choose a folder on this computer
        </Button>
        {add.isPending ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Copying it in…
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
