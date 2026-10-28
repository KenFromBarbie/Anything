import * as React from "react";
import {
  ArrowLeft,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  ImageIcon,
  ImageOff,
  Loader2,
  type LucideIcon,
  MessageSquare,
  MoreHorizontal,
  Package,
  Paperclip,
  Pin,
  PinOff,
  Send,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  proposeName,
  type ResearchProject,
  researchApi,
  sortProjects,
  useAddProjectFiles,
  useProjectFiles,
  useResearch,
  useResearchActions,
} from "@/features/research/lib/research";
import { cn } from "@/shared/lib/cn";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { PageHeader, SubsectionLabel } from "@/shared/ui/PageHeader";
import { Textarea } from "@/shared/ui/textarea";

import {
  AttachButton,
  AttachmentChips,
  dropOutline,
  useAttachments,
} from "./Attachments";
import { ProjectCover } from "./ProjectCover";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function rejectTooBig(names: string[]) {
  toast.error(`Over 200 MB, so not attached: ${names.join(", ")}`);
}

/** Half-typed briefs survive leaving the page. */
let draftBrief = "";

/**
 * Research: projects kept as folders. A project starts from a chat: describe
 * it, and Buzz makes its folder, opens a channel for it and hands the brief to
 * Michael, who researches and saves what he finds into the folder.
 */
const RESEARCH_TABS: {
  key: "projects" | "artifacts" | "browser";
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "projects", label: "Projects", icon: FolderOpen },
  { key: "artifacts", label: "Artifacts", icon: Package },
  { key: "browser", label: "Browser", icon: Globe },
];

const ArtifactsPage = React.lazy(async () => ({
  default: (await import("@/features/office/ui/ArtifactsPage")).ArtifactsPage,
}));
const BrowserPage = React.lazy(async () => ({
  default: (await import("@/features/office/ui/BrowserPage")).BrowserPage,
}));

/**
 * Research: projects, plus what the Office's agents made (Artifacts) and
 * the app's Browser, as tabs.
 */
export function ResearchPage({
  projectId,
  tab = "projects",
  artifactId = null,
}: {
  projectId: string | null;
  tab?: "projects" | "artifacts" | "browser";
  artifactId?: string | null;
}) {
  const { goArtifacts, goBrowser, goResearch } = useAppNavigation();
  if (projectId || tab === "projects") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {projectId ? null : (
          <ResearchTabs
            active="projects"
            onSelect={(key) =>
              key === "artifacts"
                ? void goArtifacts()
                : key === "browser"
                  ? void goBrowser()
                  : undefined
            }
          />
        )}
        <ResearchProjects projectId={projectId} />
      </div>
    );
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6 sm:px-6"
      data-testid={`research-tab-${tab}`}
    >
      <ResearchTabs
        active={tab}
        className="-mx-4 sm:-mx-6"
        onSelect={(key) =>
          key === "projects"
            ? void goResearch()
            : key === "artifacts"
              ? void goArtifacts()
              : void goBrowser()
        }
      />
      <PageHeader
        description={
          tab === "artifacts"
            ? "What the Office's agents made for you: decks, documents, videos, images and sites."
            : "Web pages inside the app. Agents open sites here for you to see, and read them back to check their work."
        }
        title={tab === "artifacts" ? "Artifacts" : "Browser"}
      />
      <React.Suspense fallback={null}>
        {tab === "artifacts" ? (
          <ArtifactsPage embedded initialId={artifactId} />
        ) : (
          <BrowserPage embedded />
        )}
      </React.Suspense>
    </div>
  );
}

function ResearchTabs({
  active,
  className,
  onSelect,
}: {
  active: "projects" | "artifacts" | "browser";
  className?: string;
  onSelect: (key: "projects" | "artifacts" | "browser") => void;
}) {
  return (
    <nav
      aria-label="Research"
      className={cn("flex items-center gap-1 px-4 pt-4 sm:px-6", className)}
      data-testid="research-tabs"
    >
      {RESEARCH_TABS.map(({ key, label, icon: Icon }) => (
        <button
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
            active === key
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          data-testid={`research-tab-button-${key}`}
          key={key}
          onClick={() => onSelect(key)}
          type="button"
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </nav>
  );
}

function ResearchProjects({ projectId }: { projectId: string | null }) {
  const { data, isLoading } = useResearch();
  const actions = useResearchActions();
  const { goResearch } = useAppNavigation();
  const projects = sortProjects(data?.projects ?? []);
  const opened = projectId
    ? (projects.find((p) => p.id === projectId) ?? null)
    : null;

  if (opened) {
    return (
      <ProjectDetail
        onBack={() => void goResearch()}
        onRemoved={() => void goResearch()}
        project={opened}
      />
    );
  }

  const pinned = projects.filter((p) => p.pinned);
  const rest = projects.filter((p) => !p.pinned);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6"
      data-testid="research-page-content"
    >
      <PageHeader
        action={
          <div className="flex items-center gap-2">
            <Button
              data-testid="research-add-folder"
              disabled={actions.addFolder.isPending}
              onClick={() =>
                actions.addFolder.mutate(undefined, {
                  onSuccess: (project) => {
                    if (project) toast.success(`Added ${project.name}`);
                  },
                  onError: (e) => toast.error(errorText(e)),
                })
              }
              size="sm"
              variant="outline"
            >
              <FolderPlus />
              Add a folder
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Research settings"
                  size="sm"
                  variant="ghost"
                >
                  <Settings2 />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <p className="truncate px-2 py-1.5 text-xs text-muted-foreground">
                  New projects go in {data?.root ?? "…"}
                </p>
                <DropdownMenuItem
                  onSelect={() =>
                    actions.pickRoot.mutate(undefined, {
                      onSuccess: (state) => {
                        if (state)
                          toast.success(`New projects go in ${state.root}`);
                      },
                      onError: (e) => toast.error(errorText(e)),
                    })
                  }
                >
                  <Folder />
                  Change where projects are made
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
        description="Projects are folders. Start one by describing it; Michael researches it and saves what he finds there."
        title="Research"
      />

      <StartProjectCard
        onStarted={(project, channelId) => {
          void goResearch(project.id);
          toast.success(`Started ${project.name}`, {
            action: {
              label: "Open chat",
              onClick: () => {
                window.location.hash = `#/channels/${channelId}`;
              },
            },
          });
        }}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No projects yet. Describe one above, or add a folder you already have.
        </p>
      ) : (
        <>
          {pinned.length > 0 ? (
            <ProjectGrid label="Pinned" projects={pinned} />
          ) : null}
          {rest.length > 0 ? (
            <ProjectGrid
              label={pinned.length > 0 ? "All projects" : "Projects"}
              projects={rest}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function StartProjectCard({
  onStarted,
}: {
  onStarted: (project: ResearchProject, channelId: string) => void;
}) {
  const { start } = useResearchActions();
  const [brief, setBrief] = React.useState(draftBrief);
  const [name, setName] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const nameId = React.useId();
  const attachments = useAttachments(rejectTooBig);
  const suggested = proposeName(brief);
  const finalName = (nameTouched ? name : suggested).trim();
  const ready = brief.trim().length > 0 && finalName.length > 0;

  const submit = () => {
    if (!ready || start.isPending) return;
    start.mutate(
      { name: finalName, brief, files: attachments.files },
      {
        onSuccess: ({ project, channelId, michaelAdded }) => {
          draftBrief = "";
          attachments.clear();
          setBrief("");
          setName("");
          setNameTouched(false);
          if (!michaelAdded) {
            toast.warning(
              "Michael isn't set up yet, so the brief is waiting in the project chat.",
            );
          }
          onStarted(project, channelId);
        },
        onError: (e) => toast.error(errorText(e)),
      },
    );
  };

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/40 p-4 transition-shadow",
        dropOutline(attachments.dragging),
      )}
      data-testid="research-start-card"
      {...attachments.dropProps}
    >
      {attachments.input}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessageSquare className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">What should we research?</p>
          <p className="text-xs text-muted-foreground">
            Say what you want to know and anything to focus on or avoid, and
            attach any files he should read. This becomes the project's brief
            and opens a chat with Michael.
          </p>
        </div>
      </div>
      <Textarea
        className="min-h-24 resize-y"
        data-testid="research-brief"
        onChange={(e) => {
          setBrief(e.target.value);
          draftBrief = e.target.value;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="e.g. Compare the main vector databases for a small team: cost, hosting options, and how hard each is to run."
        value={brief}
      />
      <AttachmentChips
        files={attachments.files}
        onRemove={attachments.remove}
      />
      <div className="flex flex-wrap items-center gap-2">
        <AttachButton disabled={start.isPending} onClick={attachments.open} />
        <label className="text-xs text-muted-foreground" htmlFor={nameId}>
          Project name
        </label>
        <Input
          className="h-8 max-w-xs flex-1"
          data-testid="research-name"
          id={nameId}
          onChange={(e) => {
            setNameTouched(true);
            setName(e.target.value);
          }}
          placeholder="New research"
          value={nameTouched ? name : brief.trim() ? suggested : ""}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Ctrl+Enter
          </span>
          <Button
            data-testid="research-start"
            disabled={!ready || start.isPending}
            onClick={submit}
            size="sm"
          >
            {start.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Start project
          </Button>
        </div>
      </div>
    </section>
  );
}

function ProjectGrid({
  label,
  projects,
}: {
  label: string;
  projects: ResearchProject[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <SubsectionLabel>{label}</SubsectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project }: { project: ResearchProject }) {
  const { goResearch } = useAppNavigation();
  const actions = useResearchActions();
  const togglePin = () =>
    actions.update.mutate(
      { id: project.id, patch: { pinned: !project.pinned } },
      { onError: (e) => toast.error(errorText(e)) },
    );

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card/40 transition-colors hover:border-border"
      data-testid="research-project-card"
    >
      <button
        className="flex flex-col text-left"
        onClick={() => void goResearch(project.id)}
        type="button"
      >
        <ProjectCover
          className="h-28 w-full text-3xl"
          project={project}
          showInitial
        />
        <div className="flex flex-col gap-1 p-3">
          <span className="truncate text-sm font-medium">{project.name}</span>
          <span className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
            {project.description || project.path}
          </span>
          <span className="text-[11px] text-muted-foreground/80">
            {project.exists
              ? `Updated ${ago(project.updatedAt)}`
              : "Folder missing"}
          </span>
        </div>
      </button>
      <button
        aria-label={project.pinned ? "Unpin project" : "Pin project"}
        className={cn(
          "absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-opacity",
          project.pinned
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
        data-testid="research-pin"
        onClick={togglePin}
        title={project.pinned ? "Unpin" : "Pin"}
        type="button"
      >
        {project.pinned ? (
          <Pin className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Pin className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function ProjectDetail({
  onBack,
  onRemoved,
  project,
}: {
  onBack: () => void;
  onRemoved: () => void;
  project: ResearchProject;
}) {
  const actions = useResearchActions();
  const addFiles = useAddProjectFiles(project.id);
  const attach = (files: Iterable<File>) => {
    const list = [...files].filter((f) => {
      if (f.size <= 200 * 1024 * 1024) return true;
      rejectTooBig([f.name]);
      return false;
    });
    if (list.length === 0) return;
    addFiles.mutate(list, {
      onSuccess: (saved) =>
        toast.success(
          saved.length === 1
            ? `Added ${saved[0]}`
            : `Added ${saved.length} files to sources/`,
        ),
      onError: (e) => toast.error(errorText(e)),
    });
  };
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  /** Dropping files on the Files section adds them to sources/. */
  const fileDrop = {
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        setDragging(false);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!project.exists || !event.dataTransfer.types.includes("Files"))
        return;
      event.preventDefault();
      setDragging(true);
    },
    onDrop: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(false);
      attach(event.dataTransfer.files);
    },
  };
  const { data: files = [], isLoading: filesLoading } = useProjectFiles(
    project.exists ? project.id : null,
  );
  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const nameId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => setName(project.name), [project.name]);
  React.useEffect(
    () => setDescription(project.description),
    [project.description],
  );

  const save = (patch: { name?: string; description?: string }) =>
    actions.update.mutate(
      { id: project.id, patch },
      { onError: (e) => toast.error(errorText(e)) },
    );
  const open = (file?: string) =>
    void researchApi
      .open(project.id, file)
      .catch((e: unknown) => toast.error(errorText(e)));

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="research-project-detail"
    >
      <div className="relative">
        <ProjectCover
          className="h-40 w-full text-5xl sm:h-48"
          project={project}
          showInitial
        />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <Button
            className="bg-background/80 backdrop-blur"
            onClick={onBack}
            size="sm"
            variant="outline"
          >
            <ArrowLeft />
            Research
          </Button>
          <div className="flex items-center gap-2">
            <Button
              className="bg-background/80 backdrop-blur"
              data-testid="research-change-image"
              disabled={actions.pickImage.isPending}
              onClick={() =>
                actions.pickImage.mutate(project.id, {
                  onError: (e) => toast.error(errorText(e)),
                })
              }
              size="sm"
              variant="outline"
            >
              <ImageIcon />
              {project.image ? "Change cover" : "Add a cover"}
            </Button>
            <Button
              aria-label={project.pinned ? "Unpin project" : "Pin project"}
              className="bg-background/80 backdrop-blur"
              data-testid="research-detail-pin"
              onClick={() =>
                actions.update.mutate({
                  id: project.id,
                  patch: { pinned: !project.pinned },
                })
              }
              size="sm"
              variant="outline"
            >
              {project.pinned ? <PinOff /> : <Pin />}
              {project.pinned ? "Unpin" : "Pin"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="More"
                  className="bg-background/80 backdrop-blur"
                  size="sm"
                  variant="outline"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {project.image ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      actions.clearImage.mutate(project.id, {
                        onError: (e) => toast.error(errorText(e)),
                      })
                    }
                  >
                    <ImageOff />
                    Remove the cover
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConfirmRemove(true)}>
                  <Trash2 />
                  Remove from Research
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-3">
          <label className="sr-only" htmlFor={nameId}>
            Project name
          </label>
          <Input
            className="h-auto border-transparent bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:border-input focus-visible:px-2"
            id={nameId}
            onBlur={() => {
              if (name.trim() && name.trim() !== project.name)
                save({ name: name.trim() });
              else setName(project.name);
            }}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            value={name}
          />
          <label
            className="text-xs text-muted-foreground"
            htmlFor={descriptionId}
          >
            Brief
          </label>
          <Textarea
            className="min-h-20 resize-y"
            id={descriptionId}
            onBlur={() => {
              if (description.trim() !== project.description)
                save({ description });
            }}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this project is about."
            value={description}
          />
          <div className="flex flex-wrap gap-2">
            {project.channelId ? (
              <Button
                data-testid="research-open-chat"
                onClick={() => {
                  window.location.hash = `#/channels/${project.channelId}`;
                }}
                size="sm"
              >
                <MessageSquare />
                Open the project chat
              </Button>
            ) : null}
            <Button
              data-testid="research-open-folder"
              disabled={!project.exists}
              onClick={() => open()}
              size="sm"
              variant="outline"
            >
              <FolderOpen />
              Open folder
            </Button>
            <Button
              data-testid="research-add-files"
              disabled={!project.exists || addFiles.isPending}
              onClick={() => fileInput.current?.click()}
              size="sm"
              variant="outline"
            >
              {addFiles.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Paperclip />
              )}
              Add files
            </Button>
            <input
              className="hidden"
              multiple
              onChange={(event) => {
                if (event.target.files) attach(event.target.files);
                event.target.value = "";
              }}
              ref={fileInput}
              type="file"
            />
          </div>
          <p
            className="truncate text-xs text-muted-foreground"
            title={project.path}
          >
            {project.path}
          </p>
        </div>

        <section
          className={cn(
            "-m-2 flex flex-col gap-2 rounded-2xl p-2 transition-shadow",
            dropOutline(dragging),
          )}
          {...fileDrop}
        >
          <SubsectionLabel>Files</SubsectionLabel>
          {!project.exists ? (
            <p className="text-sm text-destructive">
              The folder isn't there any more. It may have been moved or deleted
              outside Anything.
            </p>
          ) : filesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading the folder…
            </div>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Michael saves his findings here as he works;
              drop files here to add sources.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/70">
              {files.map((file) => (
                <li key={file.name}>
                  <button
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => open(file.name)}
                    type="button"
                  >
                    {file.isDir ? (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {file.isDir ? "" : size(file.size)}
                      {file.modified ? ` · ${ago(file.modified)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AlertDialog onOpenChange={setConfirmRemove} open={confirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {project.name} from Research?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It comes off this list only. The folder and its files stay where
              they are, and the project chat stays in your channels.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                actions.remove.mutate(project.id, {
                  onSuccess: onRemoved,
                  onError: (e) => toast.error(errorText(e)),
                })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
