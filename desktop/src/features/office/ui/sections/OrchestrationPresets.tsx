import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { callOffice } from "@/features/office/lib/officeLink";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";

import { ErrorLine, SectionCard } from "./SectionBits";

type Link = "michael" | "staff" | "floor" | "others";
type Models = Record<Link, string>;
type Preset = {
  id: string;
  label: string;
  blurb: string;
  custom?: boolean;
  labels: Models;
} & Models;
type Presets = {
  current: string | null;
  now: Partial<Models>;
  models: { id: string; label: string }[];
  presets: Preset[];
  live: { id: string; name: string; link: Link; model: string | null }[];
};
type Draft = { id?: string; label: string; blurb: string } & Models;

export const PRESETS_KEY = ["office", "orchestration-presets"] as const;

const LINKS: { link: Link; label: string; hint: string }[] = [
  {
    link: "michael",
    label: "Michael",
    hint: "Reads every request, assigns, signs off",
  },
  { link: "staff", label: "Staff", hint: "Plan, hand out and review" },
  { link: "floor", label: "Floor", hint: "Do the work" },
  { link: "others", label: "Everyone else", hint: "Agents you hired yourself" },
];

/** One choice that sets every tier of the office chain's model at once, from
 *  the built-in presets or ones the owner made. */
export function OrchestrationPresets({ michaelName }: { michaelName: string }) {
  const client = useQueryClient();
  const [picked, setPicked] = React.useState<Preset | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [removing, setRemoving] = React.useState<Preset | null>(null);
  const presets = useQuery({
    queryKey: PRESETS_KEY,
    queryFn: () => callOffice<Presets>("floor.presets"),
    refetchInterval: 15_000,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: PRESETS_KEY });
    void client.invalidateQueries({ queryKey: ["office", "floor-settings"] });
  };
  const apply = useMutation({
    mutationFn: (args: { id: string; restart: boolean }) =>
      callOffice<{ restarting: string[] }>("floor.applyPreset", args),
    onSuccess: ({ restarting }, { id }) => {
      const label = presets.data?.presets.find((p) => p.id === id)?.label;
      toast.success(
        restarting.length
          ? `${label}: restarting ${restarting.join(", ")} on the new models.`
          : `${label} saved. New agents start on it.`,
      );
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => callOffice("floor.deletePreset", { id }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  const data = presets.data;
  const live = data?.live ?? [];
  const moving = picked
    ? live.filter((agent) => agent.model !== picked[agent.link])
    : [];
  const linkName = (link: Link, label: string) =>
    link === "michael" ? michaelName : label;

  const newPreset = () => {
    const base =
      data?.presets.find((p) => p.id === data.current) ?? data?.presets[0];
    setDraft({
      label: "",
      blurb: "",
      michael: data?.now.michael ?? base?.michael ?? "",
      staff: data?.now.staff ?? base?.staff ?? "",
      floor: data?.now.floor ?? base?.floor ?? "",
      others: data?.now.others ?? base?.others ?? "",
    });
  };

  return (
    <SectionCard
      action={
        <Button
          disabled={!data}
          onClick={newPreset}
          size="sm"
          variant="outline"
        >
          <Plus />
          New preset
        </Button>
      }
      description="Switch every agent's model at once. Michael reads and assigns, staff plan and review, the floor does the work."
      testId="orchestration-presets"
      title="Orchestration preset"
    >
      {presets.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <ErrorLine error={presets.error} />
          </div>
          <Button onClick={() => presets.refetch()} size="sm" variant="ghost">
            <RotateCcw />
            Retry
          </Button>
        </div>
      ) : null}
      {presets.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading presets…
        </p>
      ) : null}

      {data ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {data.presets.map((preset) => {
            const on = data.current === preset.id;
            return (
              <div
                className={cn(
                  "relative rounded-xl border transition-colors",
                  on
                    ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                    : "border-border/70 hover:bg-muted/50",
                )}
                key={preset.id}
              >
                <button
                  aria-pressed={on}
                  className="grid h-full w-full gap-3 rounded-xl p-3 text-left disabled:opacity-60"
                  data-testid={`preset-${preset.id}`}
                  disabled={apply.isPending}
                  onClick={() => setPicked(preset)}
                  type="button"
                >
                  <span className="grid gap-1 pr-7">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="truncate">{preset.label}</span>
                      {on ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : null}
                      {preset.custom ? (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
                          Yours
                        </span>
                      ) : null}
                    </span>
                    {preset.blurb ? (
                      <span className="text-xs leading-snug text-muted-foreground">
                        {preset.blurb}
                      </span>
                    ) : null}
                  </span>
                  <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    {LINKS.map(({ link, label }) => (
                      <React.Fragment key={link}>
                        <dt className="text-muted-foreground">
                          {linkName(link, label)}
                        </dt>
                        <dd className="truncate text-right font-medium">
                          {preset.labels[link]}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </button>
                {preset.custom ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`${preset.label} options`}
                        className="absolute right-1.5 top-1.5"
                        size="icon-xs"
                        variant="ghost"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          setDraft({
                            id: preset.id,
                            label: preset.label,
                            blurb: preset.blurb,
                            michael: preset.michael,
                            staff: preset.staff,
                            floor: preset.floor,
                            others: preset.others,
                          })
                        }
                      >
                        <Pencil />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => setRemoving(preset)}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            );
          })}
          <button
            className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            data-testid="preset-new"
            onClick={newPreset}
            type="button"
          >
            <Plus className="h-5 w-5" />
            Make your own
          </button>
        </div>
      ) : null}
      {data && !data.current ? (
        <p className="text-xs text-muted-foreground">
          The models were set by hand, so no preset is selected. Save them as
          one with New preset.
        </p>
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setPicked(null);
        }}
        open={!!picked}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch the office to {picked?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {moving.length
                ? `${moving.map((a) => a.name).join(", ")} restart on their new models and pick their conversations back up. `
                : "Everyone on the floor is already on these models. "}
              New hires and every future launch use {picked?.label} too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {moving.length ? (
              <Button
                onClick={() => {
                  if (picked) apply.mutate({ id: picked.id, restart: false });
                  setPicked(null);
                }}
                variant="outline"
              >
                New agents only
              </Button>
            ) : null}
            <AlertDialogAction
              onClick={() => {
                if (picked)
                  apply.mutate({ id: picked.id, restart: moving.length > 0 });
              }}
            >
              {moving.length ? "Switch and restart" : "Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        open={!!removing}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {removing?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The preset goes; the agents keep the models they're on now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) remove.mutate(removing.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PresetEditor
        draft={draft}
        michaelName={michaelName}
        models={data?.models ?? []}
        onClose={() => setDraft(null)}
        onSaved={refresh}
      />
    </SectionCard>
  );
}

/** Make or change one of the owner's presets: a name and a model per tier. */
function PresetEditor({
  draft,
  michaelName,
  models,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  michaelName: string;
  models: { id: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState<Draft | null>(draft);
  React.useEffect(() => setForm(draft), [draft]);
  const save = useMutation({
    mutationFn: (preset: Draft) =>
      callOffice<string>("floor.savePreset", { preset }),
    onSuccess: (_id, preset) => {
      toast.success(
        preset.id ? `${preset.label} updated.` : `${preset.label} added.`,
      );
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const ready =
    !!form?.label.trim() && LINKS.every(({ link }) => !!form?.[link]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={!!draft}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit preset" : "New preset"}</DialogTitle>
          <DialogDescription>
            Pick a model for each tier of the office. It starts from the models
            the office runs on now.
          </DialogDescription>
        </DialogHeader>
        {form ? (
          <form
            className="grid gap-4"
            id="preset-editor"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) save.mutate(form);
            }}
          >
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                htmlFor="preset-name"
              >
                Name
              </label>
              <Input
                autoFocus
                id="preset-name"
                maxLength={40}
                onChange={(event) => set("label", event.target.value)}
                placeholder="e.g. Late-night batch"
                value={form.label}
              />
            </div>
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                htmlFor="preset-blurb"
              >
                What it's for <span className="normal-case">(optional)</span>
              </label>
              <Input
                id="preset-blurb"
                maxLength={160}
                onChange={(event) => set("blurb", event.target.value)}
                placeholder="One line on when to use it"
                value={form.blurb}
              />
            </div>
            <div className="grid gap-2">
              {LINKS.map(({ link, label: name, hint }) => (
                <div
                  className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2"
                  key={link}
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="text-sm font-medium">
                      {link === "michael" ? michaelName : name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`${name} model`}
                        className="min-w-36 justify-between"
                        size="sm"
                        variant="outline"
                      >
                        {form[link] ? label(form[link]) : "Pick a model"}
                        <ChevronDown className="opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="max-h-72 overflow-y-auto"
                    >
                      {models.map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onSelect={() => set(link, model.id)}
                        >
                          <Check
                            className={cn(
                              form[link] === model.id ? "" : "invisible",
                            )}
                          />
                          {model.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </form>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={!ready || save.isPending}
            form="preset-editor"
            type="submit"
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            {draft?.id ? "Save" : "Add preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
