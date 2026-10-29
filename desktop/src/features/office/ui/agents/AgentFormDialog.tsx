import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { accentClasses } from "@/features/office/lib/agentAccent";
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
  characters: { name: string; displayName: string }[];
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

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

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
      <label className="text-sm font-medium" htmlFor={htmlFor}>
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
      <DialogContent className="max-w-xl" data-testid="agent-form-dialog">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
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
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
              <Field htmlFor="agent-name" label="Name">
                <Input
                  autoFocus={mode === "add"}
                  data-testid="agent-form-name"
                  id="agent-name"
                  onChange={(event) => {
                    const name = event.target.value;
                    set("name", name);
                    // Naming them after a cast member picks that look
                    // ("Pam", "pam", "Pam Beesly").
                    const first = name.trim().split(/\s+/)[0]?.toLowerCase();
                    const cast = options.data?.characters.find(
                      (c) =>
                        c.displayName.toLowerCase() === first ||
                        c.name.toLowerCase() === first,
                    );
                    if (cast) set("character", cast.name);
                  }}
                  placeholder="e.g. Pam"
                  value={form.name}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field htmlFor="agent-character" label="Look on the floor">
                  <select
                    className={SELECT_CLASS}
                    id="agent-character"
                    onChange={(event) => {
                      const next = event.target.value;
                      // Picking a look names them after it, unless they
                      // already have a name of their own.
                      const previous = options.data?.characters.find(
                        (c) => c.name === form.character,
                      );
                      const picked = options.data?.characters.find(
                        (c) => c.name === next,
                      );
                      if (
                        picked &&
                        (!form.name.trim() ||
                          form.name.trim() === previous?.displayName)
                      ) {
                        set("name", picked.displayName);
                      }
                      set("character", next);
                    }}
                    value={form.character}
                  >
                    {options.data?.characters.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Color</span>
                  <div className="flex h-9 items-center gap-2">
                    {options.data?.accents.map((accent) => (
                      <button
                        aria-label={accent}
                        aria-pressed={form.accent === accent}
                        className={cn(
                          "h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition",
                          accentClasses(accent).solid,
                          form.accent === accent
                            ? "ring-2 ring-ring"
                            : "opacity-80 hover:opacity-100",
                        )}
                        key={accent}
                        onClick={() => set("accent", accent)}
                        type="button"
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field htmlFor="agent-engine" label="Engine">
                  <select
                    className={SELECT_CLASS}
                    data-testid="agent-form-engine"
                    id="agent-engine"
                    onChange={(event) => {
                      const next = options.data?.providers.find(
                        (p) => p.id === event.target.value,
                      );
                      set("provider", event.target.value);
                      set("model", next?.defaultModel ?? null);
                    }}
                    value={form.provider}
                  >
                    {options.data?.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="agent-model" label="Model">
                  <select
                    className={SELECT_CLASS}
                    disabled={!provider || provider.models.length === 0}
                    id="agent-model"
                    onChange={(event) =>
                      set("model", event.target.value || null)
                    }
                    value={form.model ?? ""}
                  >
                    <option value="">Engine default</option>
                    {provider?.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {form.model &&
                    !provider?.models.some((m) => m.id === form.model) ? (
                      <option value={form.model}>{form.model}</option>
                    ) : null}
                  </select>
                </Field>
              </div>

              {mode === "add" ? (
                <>
                  <Field htmlFor="agent-folder" label="Works in">
                    <div className="flex gap-2">
                      <select
                        className={SELECT_CLASS}
                        data-testid="agent-form-folder"
                        id="agent-folder"
                        onChange={(event) => set("cwd", event.target.value)}
                        value={form.cwd}
                      >
                        {folders.length === 0 ? (
                          <option value="">No folder yet</option>
                        ) : null}
                        {folders.map((folder) => (
                          <option key={folder} value={folder}>
                            {folder}
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={chooseFolder}
                        type="button"
                        variant="outline"
                      >
                        <FolderOpen />
                        Choose…
                      </Button>
                    </div>
                  </Field>
                  <label
                    className="flex items-start gap-3 text-sm"
                    htmlFor="agent-isolate"
                  >
                    <Switch
                      checked={form.isolate}
                      id="agent-isolate"
                      onCheckedChange={(on) => set("isolate", on)}
                    />
                    <span>
                      <span className="font-medium">Own git worktree</span>
                      <span className="block text-xs text-muted-foreground">
                        Works on a separate checkout of the folder, so its
                        changes don't collide with other agents'.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}

              <Field
                hint="One line: what this agent is for."
                htmlFor="agent-role"
                label="Role"
              >
                <Input
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
                  className="min-h-20"
                  id="agent-goal"
                  onChange={(event) => set("goal", event.target.value)}
                  value={form.goal}
                />
              </Field>
            </div>
          )}

          {error ? (
            <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
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
