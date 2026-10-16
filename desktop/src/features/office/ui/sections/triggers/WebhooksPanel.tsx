import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { officeCth } from "@/features/office/lib/officeCth";
import { callOffice } from "@/features/office/lib/officeLink";
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
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

import { ErrorLine, Muted } from "../SectionBits";
import {
  copyText,
  SecretInput,
  TRUST_MODES,
  type TrustMode,
  TrustSelect,
} from "./triggerBits";

type Webhook = {
  id: string;
  name: string;
  secret: string;
  enabled: boolean;
  mode: TrustMode;
  schema: string;
  createdAt: number;
};
type Status = { running: boolean; endpoints: { id: string; url: string }[] };

const KEY = ["office", "webhooks"] as const;

/** The Office's default body schema for a new endpoint. */
const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "object",
    required: ["message"],
    properties: {
      message: {
        type: "string",
        description: "What you want the orchestrator to know or do.",
      },
      title: {
        type: "string",
        description: "Short label for the kanban card.",
      },
      kind: {
        type: "string",
        enum: ["directive", "communication"],
        description:
          "directive = asks the hive to act; communication = informational.",
      },
      from: {
        type: "string",
        description: "Who is sending, for the trigger history.",
      },
    },
  },
  null,
  2,
);

function localSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function WebhookRow({
  hook,
  url,
  running,
  onPatch,
  onDelete,
}: {
  hook: Webhook;
  url: string;
  running: boolean;
  onPatch: (fields: Partial<Webhook>, persist?: boolean) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [schema, setSchema] = React.useState(hook.schema);
  const [schemaError, setSchemaError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const mode =
    TRUST_MODES.find((m) => m.value === hook.mode)?.label ?? hook.mode;

  return (
    <li className="grid gap-2 rounded-xl border border-border/70 px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            setOpen((o) => !o);
            setSchema(hook.schema);
            setSchemaError(null);
          }}
          type="button"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">{hook.name || "unnamed"}</span>
          <span className="truncate text-xs text-muted-foreground">
            {mode} ·{" "}
            {url ? "reachable" : running ? "no URL yet" : "server offline"}
          </span>
        </button>
        <Switch
          aria-label={hook.enabled ? "Turn off" : "Turn on"}
          checked={hook.enabled}
          onCheckedChange={(enabled) => onPatch({ enabled })}
        />
      </div>
      {open ? (
        <div className="grid gap-3 pl-6">
          <label
            className="grid gap-1.5 text-sm font-medium"
            htmlFor={`${hook.id}-name`}
          >
            Name
            <Input
              id={`${hook.id}-name`}
              onBlur={() => onPatch({ name: hook.name })}
              onChange={(event) => onPatch({ name: event.target.value }, false)}
              placeholder="Who calls this"
              value={hook.name}
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Post to</span>
            {url ? (
              <div className="flex gap-2">
                <Input className="font-mono text-xs" readOnly value={url} />
                <Button
                  aria-label="Copy URL"
                  onClick={() => void copyText(url, "URL")}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Copy />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {running
                  ? "No public address yet. It appears once the tunnel picks this endpoint up."
                  : "The webhook server isn't listening, so there's no address to hand out yet."}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Secret</span>
            <SecretInput copyLabel="Secret" readOnly value={hook.secret} />
            <p className="text-xs text-muted-foreground">
              Callers send it in the x-md-webhook-secret header.
            </p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Trust</span>
            <TrustSelect
              onChange={(m) => onPatch({ mode: m })}
              value={hook.mode}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Body schema</span>
            <Textarea
              className="min-h-40 font-mono text-xs"
              onChange={(event) => setSchema(event.target.value)}
              value={schema}
            />
            {schemaError ? (
              <ErrorLine
                error={`Not valid JSON: ${schemaError}. Nothing was saved.`}
              />
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                disabled={schema === hook.schema}
                onClick={() => {
                  try {
                    JSON.parse(schema);
                  } catch (e) {
                    setSchemaError(e instanceof Error ? e.message : String(e));
                    return;
                  }
                  setSchemaError(null);
                  onPatch({ schema });
                  toast.success("Schema saved.");
                }}
                size="sm"
                variant="outline"
              >
                Save schema
              </Button>
              <span className="flex-1" />
              <Button
                onClick={() => setConfirm(true)}
                size="sm"
                variant="ghost"
              >
                <Trash2 />
                Delete endpoint
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <AlertDialog onOpenChange={setConfirm} open={confirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{hook.name || "unnamed"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its URL stops working for whoever calls it. Other endpoints keep
              their own secrets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** Endpoints an outside system can post work to. */
export function WebhooksPanel() {
  const client = useQueryClient();
  const hooks = useQuery({
    queryKey: KEY,
    queryFn: () => officeCth<Webhook[] | null>("listWebhooks"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const status = useQuery({
    queryKey: ["office", "webhooks-status"],
    queryFn: () => officeCth<Status>("webhooksStatus"),
    refetchInterval: 5_000,
  });
  const list = hooks.data ?? [];
  const save = (next: Webhook[]) => {
    client.setQueryData(KEY, next);
    void callOffice<Webhook[] | null>("triggers.webhooks.save", { list: next })
      .then((canonical) => {
        if (canonical) client.setQueryData(KEY, canonical);
      })
      .catch((error: Error) => toast.error(error.message));
  };
  const add = useMutation({
    mutationFn: async () => {
      let secret = "";
      try {
        secret = (await officeCth<string>("generateWebhookSecret")) || "";
      } catch {
        // A locally minted secret still persists through the save.
      }
      return secret || localSecret();
    },
    onSuccess: (secret) =>
      save([
        ...list,
        {
          id: `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: list.length === 0 ? "inbound" : `inbound ${list.length + 1}`,
          secret,
          enabled: false,
          mode: "strict",
          schema: DEFAULT_SCHEMA,
          createdAt: Date.now(),
        },
      ]),
  });
  const urlFor = (id: string) =>
    status.data?.endpoints.find((e) => e.id === id)?.url ?? "";

  return (
    <div className="grid gap-3">
      <Muted>
        Anyone holding a URL and its secret can post work in. Each endpoint has
        its own secret, so revoking one caller leaves the others alone.
      </Muted>
      {list.length === 0 && !hooks.isLoading ? (
        <Muted>No endpoints yet.</Muted>
      ) : null}
      <ul className="grid gap-2">
        {list.map((hook) => (
          <WebhookRow
            hook={hook}
            key={hook.id}
            onDelete={() => {
              client.setQueryData(
                KEY,
                list.filter((w) => w.id !== hook.id),
              );
              void callOffice<Webhook[] | null>("triggers.webhooks.delete", {
                id: hook.id,
              })
                .then((canonical) => {
                  if (canonical) client.setQueryData(KEY, canonical);
                })
                .catch((error: Error) => toast.error(error.message));
            }}
            onPatch={(fields, persist = true) => {
              const next = list.map((w) =>
                w.id === hook.id ? { ...w, ...fields } : w,
              );
              if (persist) save(next);
              else client.setQueryData(KEY, next);
            }}
            running={!!status.data?.running}
            url={urlFor(hook.id)}
          />
        ))}
      </ul>
      <div className="grid gap-1">
        <div>
          <Button
            disabled={add.isPending}
            onClick={() => add.mutate()}
            size="sm"
            variant="outline"
          >
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Add webhook
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A new endpoint starts switched off. Copy its URL and secret, then turn
          it on.
        </p>
      </div>
    </div>
  );
}
