import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
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

import { SectionCard } from "./SectionBits";

type Link = "michael" | "staff" | "floor" | "others";
type Preset = {
  id: string;
  label: string;
  blurb: string;
  labels: Record<Link, string>;
} & Record<Link, string>;
type Presets = {
  current: string | null;
  presets: Preset[];
  live: { id: string; name: string; link: Link; model: string | null }[];
};

export const PRESETS_KEY = ["office", "orchestration-presets"] as const;

const LINKS: { link: Link; label: string }[] = [
  { link: "michael", label: "Michael" },
  { link: "staff", label: "Staff" },
  { link: "floor", label: "Floor" },
  { link: "others", label: "Everyone else" },
];

/** One choice that sets every tier of the office chain's model at once. */
export function OrchestrationPresets({ michaelName }: { michaelName: string }) {
  const client = useQueryClient();
  const [picked, setPicked] = React.useState<Preset | null>(null);
  const presets = useQuery({
    queryKey: PRESETS_KEY,
    queryFn: () => callOffice<Presets>("floor.presets"),
    refetchInterval: 15_000,
  });
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
      void client.invalidateQueries({ queryKey: PRESETS_KEY });
      void client.invalidateQueries({ queryKey: ["office", "floor-settings"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const live = presets.data?.live ?? [];
  const moving = picked
    ? live.filter((agent) => agent.model !== picked[agent.link])
    : [];
  const name = (link: Link) => (link === "michael" ? michaelName : null);

  return (
    <SectionCard
      description="Switch every agent's model at once. Michael reads and assigns, staff plan and review, the floor does the work."
      testId="orchestration-presets"
      title="Orchestration preset"
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {(presets.data?.presets ?? []).map((preset) => {
          const on = presets.data?.current === preset.id;
          return (
            <button
              aria-pressed={on}
              className={cn(
                "grid gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
                on
                  ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                  : "border-border/70 hover:bg-muted/50",
              )}
              data-testid={`preset-${preset.id}`}
              disabled={apply.isPending}
              key={preset.id}
              onClick={() => setPicked(preset)}
              type="button"
            >
              <span className="grid gap-1">
                <span className="flex items-center gap-1.5 font-medium">
                  {preset.label}
                  {on ? <Check className="h-4 w-4 text-primary" /> : null}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {preset.blurb}
                </span>
              </span>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {LINKS.map(({ link, label }) => (
                  <React.Fragment key={link}>
                    <dt className="text-muted-foreground">
                      {name(link) ?? label}
                    </dt>
                    <dd className="truncate text-right font-medium">
                      {preset.labels[link]}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </button>
          );
        })}
      </div>
      {presets.data && !presets.data.current ? (
        <p className="text-xs text-muted-foreground">
          The models were set by hand, so no preset is selected.
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
              {apply.isPending ? <Loader2 className="animate-spin" /> : null}
              {moving.length ? "Switch and restart" : "Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
