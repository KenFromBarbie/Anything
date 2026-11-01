import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { accentClasses } from "@/features/office/lib/agentAccent";
import {
  OFFICE_GLASS,
  OFFICE_GLASS_OVERLAY,
} from "@/features/office/lib/glass";
import { callOffice, sendToOffice } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

type HireOptions = {
  providers: {
    id: string;
    label: string;
    defaultModel: string | null;
    models: { id: string; label: string }[];
  }[];
  defaultProvider: string;
  repos: string[];
  characters: {
    name: string;
    displayName: string;
    blurb?: string;
    /** Their floor portrait (a PNG data URL); older Offices send none. */
    portrait?: string;
  }[];
  accents: string[];
};

type Details = {
  name: string;
  character: string;
  accent: string;
  description: string;
  goal: string;
  provider: string;
  model: string | null;
};

type Form = Details & { cwd: string; isolate: boolean };

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Add an agent to the floor, or edit one, in Buzz's own UI. The Office does
 * the work (`agents.hire` / `agent.update`, the same path as its own forms);
 * importing a hire file, resuming a session or a custom command are still in
 * the Office's form, one click away.
 */
export function AgentFormDialog({
  mode,
  agentId,
  open,
  onOpenChange,
}: {
  mode: "add" | "edit";
  agentId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const options = useQuery({
    queryKey: ["office", "hire-options"],
    queryFn: () => callOffice<HireOptions>("hire.options"),
    enabled: open,
    staleTime: 30_000,
  });
  const details = useQuery({
    queryKey: ["office", "agent-details", agentId ?? ""],
    queryFn: () => callOffice<Details>("agent.details", { id: agentId }),
    enabled: open && mode === "edit" && !!agentId,
    staleTime: 0,
  });
  const [form, setForm] = React.useState<Form | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A fresh form each time the dialog opens, once its data is in.
  React.useEffect(() => {
    if (!open) {
      setForm(null);
      setError(null);
      return;
    }
    if (form || !options.data) return;
    const o = options.data;
    if (mode === "edit") {
      if (!details.data) return;
      setForm({ ...details.data, cwd: "", isolate: false });
      return;
    }
    const provider =
      o.providers.find((p) => p.id === o.defaultProvider) ?? o.providers[0];
    setForm({
      name: "",
      character: "jim",
      accent: "sky",
      description: "",
      goal: "",
      provider: provider?.id ?? "claude",
      model: provider?.defaultModel ?? null,
      cwd: o.repos[0] ?? "",
      isolate: false,
    });
  }, [open, form, options.data, details.data, mode]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const provider = options.data?.providers.find((p) => p.id === form?.provider);
  const repos = options.data?.repos ?? [];
  const folders =
    form?.cwd && !repos.includes(form.cwd) ? [form.cwd, ...repos] : repos;

  const cast = options.data?.characters ?? [];
  const look = cast.find((c) => c.name === form?.character);
  const modelLabel =
    provider?.models.find((m) => m.id === form?.model)?.label ??
    form?.model ??
    "Engine default";

  /** Picking a look names them after it, unless they have a name of their own. */
  const pickLook = (next: string) => {
    if (!form) return;
    const previous = cast.find((c) => c.name === form.character);
    const picked = cast.find((c) => c.name === next);
    if (
      picked &&
      (!form.name.trim() || form.name.trim() === previous?.displayName)
    ) {
      set("name", picked.displayName);
    }
    set("character", next);
  };

  const chooseFolder = async () => {
    try {
      const path = await callOffice<string | null>("hire.chooseFolder");
      if (path) set("cwd", path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || busy) return;
    if (!form.name.trim()) return setError("Give the agent a name.");
    if (mode === "add" && !form.cwd) {
      return setError("Pick a folder for the agent to work in.");
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "add") {
        await callOffice("agents.hire", { ...form, model: form.model ?? "" });
        toast.success(`${form.name.trim()} is joining the floor.`);
      } else {
        await callOffice("agent.update", {
          id: agentId,
          ...form,
          model: form.model ?? "",
        });
        toast.success("Saved.");
      }
      void client.invalidateQueries({ queryKey: ["office"] });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loading = !form;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn("max-w-3xl gap-0 overflow-hidden p-0", OFFICE_GLASS)}
        data-testid="agent-form-dialog"
        overlayClassName={OFFICE_GLASS_OVERLAY}
        overlayVariant="transparent"
      >
        <form className="flex max-h-[85vh] flex-col" onSubmit={submit}>
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>
              {mode === "add"
                ? "Add an agent"
                : `Edit ${form?.name || "agent"}`}
            </DialogTitle>
            <DialogDescription>
              {mode === "add"
                ? "A new agent on Michael's floor, with its own terminal. Michael can hand it work, and you can add it to channels."
                : "Name, look and briefing apply now; an engine change applies the next time the agent restarts."}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 px-6 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 pb-6 sm:grid-cols-[13rem_1fr]">
              {/* How they'll look on the floor, as you build them. */}
              <aside className="flex flex-col gap-3 sm:sticky sm:top-0 sm:self-start">
                <div
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-2xl border border-border/60 px-4 pt-6 pb-4",
                    accentClasses(form.accent).soft,
                  )}
                  data-testid="agent-form-preview"
                >
                  <div className="flex h-28 w-28 items-end justify-center rounded-2xl bg-background/70 shadow-inner">
                    {look?.portrait ? (
                      <img
                        alt=""
                        className="h-24 [image-rendering:pixelated]"
                        src={look.portrait}
                      />
                    ) : (
                      <span
                        className={cn(
                          "mb-6 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold",
                          accentClasses(form.accent).solid,
                        )}
                      >
                        {form.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                    )}
                  </div>
                  <div className="grid w-full gap-0.5 text-center">
                    <span className="truncate text-base font-semibold">
                      {form.name.trim() || look?.displayName || "New agent"}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {form.description.trim() ||
                        look?.blurb ||
                        "What they're for"}
                    </span>
                  </div>
                  <span className="max-w-full truncate rounded-full bg-background/80 px-2.5 py-1 text-2xs text-muted-foreground">
                    {provider?.label ?? form.provider} · {modelLabel}
                  </span>
                </div>
                <div className="flex justify-center gap-2">
                  {options.data?.accents.map((accent) => (
                    <button
                      aria-label={accent}
                      aria-pressed={form.accent === accent}
                      className={cn(
                        "h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition",
                        accentClasses(accent).solid,
                        form.accent === accent
                          ? "ring-2 ring-foreground/70"
                          : "opacity-70 hover:opacity-100",
                      )}
                      key={accent}
                      onClick={() => set("accent", accent)}
                      type="button"
                    />
                  ))}
                </div>
              </aside>

              <div className="grid content-start gap-5">
                <Field htmlFor="agent-name" label="Name">
                  <Input
                    autoFocus={mode === "add"}
                    className="h-10 border-foreground/10 bg-foreground/[0.04] text-base"
                    data-testid="agent-form-name"
                    id="agent-name"
                    onChange={(event) => {
                      const name = event.target.value;
                      set("name", name);
                      // Naming them after a cast member picks that look
                      // ("Pam", "pam", "Pam Beesly").
                      const first = name.trim().split(/\s+/)[0]?.toLowerCase();
                      const match = cast.find(
                        (c) =>
                          c.displayName.toLowerCase() === first ||
                          c.name.toLowerCase() === first,
                      );
                      if (match) set("character", match.name);
                    }}
                    placeholder="e.g. Pam"
                    value={form.name}
                  />
                </Field>

                <Field label="Look on the floor">
                  <div
                    className="grid grid-cols-5 gap-1.5 sm:grid-cols-8"
                    data-testid="agent-form-look"
                  >
                    {cast.map((c) => {
                      const on = form.character === c.name;
                      return (
                        <button
                          aria-label={c.displayName}
                          aria-pressed={on}
                          className={cn(
                            "flex aspect-square items-end justify-center overflow-hidden rounded-xl border transition-colors",
                            on
                              ? cn(
                                  "border-foreground/60",
                                  accentClasses(form.accent).soft,
                                )
                              : "border-foreground/10 bg-foreground/[0.04] hover:border-foreground/30",
                          )}
                          key={c.name}
                          onClick={() => pickLook(c.name)}
                          title={
                            c.blurb
                              ? `${c.displayName}: ${c.blurb}`
                              : c.displayName
                          }
                          type="button"
                        >
                          {c.portrait ? (
                            <img
                              alt=""
                              className="h-[85%] [image-rendering:pixelated]"
                              src={c.portrait}
                            />
                          ) : (
                            <span className="my-auto text-xs">
                              {c.displayName}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Engine">
                  <Choices
                    onPick={(id) => {
                      const next = options.data?.providers.find(
                        (p) => p.id === id,
                      );
                      set("provider", id);
                      set("model", next?.defaultModel ?? null);
                    }}
                    options={(options.data?.providers ?? []).map((p) => ({
                      id: p.id,
                      label: p.label,
                    }))}
                    testId="agent-form-engine"
                    value={form.provider}
                  />
                </Field>

                {provider && provider.models.length > 0 ? (
                  <Field label="Model">
                    <Choices
                      onPick={(id) => set("model", id || null)}
                      options={[
                        { id: "", label: "Engine default" },
                        ...provider.models,
                        ...(form.model &&
                        !provider.models.some((m) => m.id === form.model)
                          ? [{ id: form.model, label: form.model }]
                          : []),
                      ]}
                      value={form.model ?? ""}
                    />
                  </Field>
                ) : null}

                {mode === "add" ? (
                  <Field label="Works in">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="flex h-11 w-full items-center gap-3 rounded-xl border border-border/60 bg-foreground/[0.04] px-3 text-left transition-colors hover:border-foreground/30"
                          data-testid="agent-form-folder"
                          type="button"
                        >
                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="grid min-w-0 flex-1">
                            <span className="truncate text-sm font-medium">
                              {form.cwd
                                ? form.cwd.split(/[\\/]/).filter(Boolean).pop()
                                : "Pick a folder"}
                            </span>
                            {form.cwd ? (
                              <span className="truncate text-2xs text-muted-foreground">
                                {form.cwd}
                              </span>
                            ) : null}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[var(--radix-dropdown-menu-trigger-width)]"
                      >
                        {folders.map((folder) => (
                          <DropdownMenuItem
                            key={folder}
                            onSelect={() => set("cwd", folder)}
                          >
                            {folder === form.cwd ? (
                              <Check />
                            ) : (
                              <span className="w-4" />
                            )}
                            <span className="truncate">{folder}</span>
                          </DropdownMenuItem>
                        ))}
                        {folders.length ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem onSelect={() => void chooseFolder()}>
                          <FolderOpen />
                          Choose another folder…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <label
                      className="mt-1 flex items-center gap-3 rounded-xl border border-border/60 bg-foreground/[0.04] px-3 py-2.5 text-sm"
                      htmlFor="agent-isolate"
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="grid flex-1">
                        <span className="font-medium">Own git worktree</span>
                        <span className="text-xs text-muted-foreground">
                          A separate checkout, so its changes don't collide with
                          other agents'.
                        </span>
                      </span>
                      <Switch
                        checked={form.isolate}
                        id="agent-isolate"
                        onCheckedChange={(on) => set("isolate", on)}
                      />
                    </label>
                  </Field>
                ) : null}

                <Field
                  hint="One line: what this agent is for."
                  htmlFor="agent-role"
                  label="Role"
                >
                  <Input
                    className="border-foreground/10 bg-foreground/[0.04]"
                    id="agent-role"
                    onChange={(event) => set("description", event.target.value)}
                    placeholder="keeps the docs in sync with the code"
                    value={form.description}
                  />
                </Field>
                <Field
                  hint="A standing instruction the agent works toward on every turn."
                  htmlFor="agent-goal"
                  label="Goal"
                >
                  <Textarea
                    className="min-h-20 border-foreground/10 bg-foreground/[0.04]"
                    id="agent-goal"
                    onChange={(event) => set("goal", event.target.value)}
                    value={form.goal}
                  />
                </Field>
              </div>
            </div>
          )}

          {error ? (
            <p className="mx-6 mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-foreground/10 px-6 py-3 sm:justify-between">
            {mode === "add" ? (
              <button
                className="text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => {
                  onOpenChange(false);
                  sendToOffice({ type: "add-agent" });
                }}
                title="Import a hire file, resume an existing session, or use a custom command."
                type="button"
              >
                More options in the Office…
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                data-testid="agent-form-submit"
                disabled={loading || busy}
                type="submit"
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                {mode === "add" ? "Add agent" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One of a few, as pills (engines, models). */
function Choices({
  options,
  value,
  onPick,
  testId,
}: {
  options: { id: string; label: string }[];
  value: string;
  onPick: (id: string) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map((option) => (
        <button
          aria-pressed={value === option.id}
          className={cn(
            "h-8 rounded-full border px-3 text-sm transition-colors",
            value === option.id
              ? "border-foreground/70 bg-foreground text-background"
              : "border-foreground/10 bg-foreground/[0.04] text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          )}
          key={option.id || "default"}
          onClick={() => onPick(option.id)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
