import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  LogIn,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  type AccountUsage,
  type AiAccount,
  API_KEY_HINT,
  addAiAccount,
  addApiKeyAccount,
  aiAccountUsage,
  ENGINE_CLI_NAME,
  type Engine,
  type EngineAccounts,
  listAiAccounts,
  removeAiAccount,
  renameAiAccount,
  setActiveAiAccount,
  setAiAccountApiKey,
  signInAiAccount,
  type UsageWindow,
  windowTotal,
} from "@/features/settings/lib/aiAccounts";
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
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";

import {
  SettingsOptionGroup,
  SettingsOptionGroupList,
} from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

const LIST_KEY = ["ai-accounts"] as const;

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function resetsIn(unixSeconds: number | null): string | null {
  if (!unixSeconds) return null;
  const minutes = Math.round((unixSeconds * 1000 - Date.now()) / 60_000);
  if (minutes <= 0) return "resets now";
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `resets in ${hours}h`;
  return `resets in ${Math.round(hours / 24)}d`;
}

function WindowStat({ label, window }: { label: string; window: UsageWindow }) {
  return (
    <div
      className="rounded-xl bg-muted/40 px-3 py-2"
      title={`Input ${window.input.toLocaleString()} · output ${window.output.toLocaleString()} · cache read ${window.cacheRead.toLocaleString()} · cache write ${window.cacheWrite.toLocaleString()}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">
        {fmtTokens(windowTotal(window))}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          tokens
        </span>
      </p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {window.requests.toLocaleString()} replies · {fmtTokens(window.output)}{" "}
        out
      </p>
    </div>
  );
}

function UsagePanel({
  engine,
  account,
}: {
  engine: Engine;
  account: AiAccount;
}) {
  const usage = useQuery({
    queryKey: ["ai-accounts", "usage", engine, account.id],
    queryFn: () => aiAccountUsage(engine, account.id),
    refetchInterval: 60_000,
  });
  const data: AccountUsage | undefined = usage.data;
  if (usage.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading usage…
      </p>
    );
  }
  if (usage.error || !data) {
    return (
      <p className="text-sm text-destructive">
        {usage.error instanceof Error
          ? usage.error.message
          : "Couldn't read usage."}
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      {data.limits.length > 0 ? (
        <div className="grid gap-2">
          {data.limits.map((limit) => (
            <div className="grid gap-1" key={limit.label}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {limit.label}
                  {data.plan ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {data.plan}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(limit.usedPercent)}% used
                  {resetsIn(limit.resetsAt)
                    ? ` · ${resetsIn(limit.resetsAt)}`
                    : ""}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    limit.usedPercent >= 90
                      ? "bg-destructive"
                      : limit.usedPercent >= 70
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                  )}
                  style={{ width: `${Math.min(100, limit.usedPercent)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <WindowStat label="Last 5 hours" window={data.last5h} />
        <WindowStat label="Today" window={data.today} />
        <WindowStat label="Last 7 days" window={data.week} />
      </div>
      {data.note ? (
        <p className="text-xs text-muted-foreground">{data.note}</p>
      ) : null}
    </div>
  );
}

function AccountRow({
  engine,
  account,
  active,
  onRename,
  onRemove,
}: {
  engine: EngineAccounts;
  account: AiAccount;
  active: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = React.useState(active);
  const use = useMutation({
    mutationFn: () => setActiveAiAccount(engine.engine, account.id),
    onSuccess: () => {
      toast.success(
        `${engine.label} agents will use ${account.isDefault ? "this computer's sign-in" : account.label}. Running agents switch when they restart.`,
      );
      void client.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const [replacingKey, setReplacingKey] = React.useState(false);
  const [newKey, setNewKey] = React.useState("");
  const replaceKey = useMutation({
    mutationFn: () => setAiAccountApiKey(engine.engine, account.id, newKey),
    onSuccess: () => {
      toast.success("API key replaced.");
      setReplacingKey(false);
      setNewKey("");
      void client.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const signIn = () =>
    void signInAiAccount(engine.engine, account.id)
      .then(() =>
        toast(
          `Finish signing in to ${engine.label} in the terminal that opened.`,
        ),
      )
      .catch((error: Error) => toast.error(error.message));

  return (
    <div
      className="grid gap-3 px-4 py-3"
      data-testid={`ai-account-${engine.engine}-${account.id}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{account.label}</span>
              {active ? <Badge variant="success">In use</Badge> : null}
              {account.plan ? (
                <Badge variant="outline">{account.plan}</Badge>
              ) : null}
              {!account.signedIn ? (
                <Badge variant="warning">Not signed in</Badge>
              ) : null}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {account.email ??
                (account.signedIn ? "Signed in" : "No account yet")}
              {account.organization ? ` · ${account.organization}` : ""}
            </span>
          </span>
        </button>
        {!account.signedIn ? (
          <Button onClick={signIn} size="sm" variant="outline">
            <LogIn />
            Sign in
          </Button>
        ) : !active ? (
          <Button
            disabled={use.isPending}
            onClick={() => use.mutate()}
            size="sm"
            variant="outline"
          >
            {use.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Use for agents
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`More for ${account.label}`}
              size="icon"
              variant="ghost"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {account.apiKey ? (
              <DropdownMenuItem onSelect={() => setReplacingKey(true)}>
                <KeyRound />
                Replace API key
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={signIn}>
                <LogIn />
                {account.signedIn ? "Sign in again" : "Sign in"}
              </DropdownMenuItem>
            )}
            {account.isDefault ? null : (
              <>
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={onRemove}
                >
                  <Trash2 />
                  Remove account
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {replacingKey ? (
        <form
          className="flex flex-wrap items-center gap-2 pl-6"
          onSubmit={(event) => {
            event.preventDefault();
            replaceKey.mutate();
          }}
        >
          <ApiKeyInput
            engine={engine.engine}
            onChange={setNewKey}
            value={newKey}
          />
          <Button
            disabled={!newKey.trim() || replaceKey.isPending}
            size="sm"
            type="submit"
          >
            {replaceKey.isPending ? <Loader2 className="animate-spin" /> : null}
            Save key
          </Button>
          <Button
            onClick={() => {
              setReplacingKey(false);
              setNewKey("");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        </form>
      ) : null}
      {open ? (
        <div className="pl-6">
          {account.signedIn ? (
            <UsagePanel account={account} engine={engine.engine} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Sign in to see this account's usage.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EngineGroup({ engine }: { engine: EngineAccounts }) {
  const client = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [how, setHow] = React.useState<"sign-in" | "api-key">("sign-in");
  const [key, setKey] = React.useState("");
  const [renaming, setRenaming] = React.useState<AiAccount | null>(null);
  const [renameText, setRenameText] = React.useState("");
  const [removing, setRemoving] = React.useState<AiAccount | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: LIST_KEY });

  const add = useMutation({
    mutationFn: () =>
      how === "api-key"
        ? addApiKeyAccount(engine.engine, label.trim() || "API key", key)
        : addAiAccount(engine.engine, label.trim() || "New account"),
    onSuccess: () => {
      toast(
        how === "api-key"
          ? `Added. Pick "Use for agents" to run ${engine.label} agents on this key.`
          : `A terminal opened to sign in to ${engine.label}. Finish there; the account shows up here when you're done.`,
      );
      setAdding(false);
      setLabel("");
      setKey("");
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const rename = useMutation({
    mutationFn: (account: AiAccount) =>
      renameAiAccount(engine.engine, account.id, renameText),
    onSuccess: () => {
      setRenaming(null);
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (account: AiAccount) =>
      removeAiAccount(engine.engine, account.id),
    onSuccess: () => {
      toast("Account removed; its folder is in the Recycle Bin.");
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <SettingsOptionGroup
      data-testid={`ai-accounts-${engine.engine}`}
      description={
        engine.cliInstalled
          ? `${ENGINE_CLI_NAME[engine.engine]} agents run on the account in use.`
          : undefined
      }
      headerAction={
        <Button
          disabled={!engine.cliInstalled}
          onClick={() => setAdding((a) => !a)}
          size="sm"
          variant="outline"
        >
          <Plus />
          Add account
        </Button>
      }
      title={engine.label}
    >
      {!engine.cliInstalled ? (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {ENGINE_CLI_NAME[engine.engine]} isn't installed on this computer, so
          there's nothing to sign in to yet.
        </p>
      ) : null}
      {adding ? (
        <form
          className="grid gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <div className="flex w-fit gap-1 rounded-lg bg-muted/60 p-1 text-sm">
            {(
              [
                ["sign-in", "Sign in to a subscription"],
                ["api-key", "Use an API key"],
              ] as const
            ).map(([value, text]) => (
              <button
                aria-pressed={how === value}
                className={cn(
                  "rounded-md px-3 py-1",
                  how === value
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={value}
                onClick={() => setHow(value)}
                type="button"
              >
                {text}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              className="max-w-xs"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Name it, e.g. Work"
              value={label}
            />
            {how === "api-key" ? (
              <ApiKeyInput
                engine={engine.engine}
                onChange={setKey}
                value={key}
              />
            ) : null}
            <Button
              disabled={add.isPending || (how === "api-key" && !key.trim())}
              size="sm"
              type="submit"
            >
              {add.isPending ? (
                <Loader2 className="animate-spin" />
              ) : how === "api-key" ? (
                <KeyRound />
              ) : (
                <LogIn />
              )}
              {how === "api-key" ? "Add key" : "Add and sign in"}
            </Button>
            <Button
              onClick={() => setAdding(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
          {how === "api-key" ? (
            <p className="text-xs text-muted-foreground">
              The key stays on this computer in the account's own folder, where{" "}
              {ENGINE_CLI_NAME[engine.engine]} reads it. It's never put in the
              agents' environment. Use is billed to the API account, not a
              subscription.
            </p>
          ) : null}
        </form>
      ) : null}
      {(engine.cliInstalled
        ? engine.accounts
        : engine.accounts.filter((account) => account.signedIn)
      ).map((account) =>
        renaming?.id === account.id ? (
          <form
            className="flex items-center gap-2 px-4 py-3"
            key={account.id}
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate(account);
            }}
          >
            <Input
              autoFocus
              className="max-w-xs"
              onChange={(event) => setRenameText(event.target.value)}
              value={renameText}
            />
            <Button disabled={rename.isPending} size="sm" type="submit">
              Save
            </Button>
            <Button
              onClick={() => setRenaming(null)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </form>
        ) : (
          <AccountRow
            account={account}
            active={engine.active === account.id}
            engine={engine}
            key={account.id}
            onRemove={() => setRemoving(account)}
            onRename={() => {
              setRenaming(account);
              setRenameText(account.label);
            }}
          />
        ),
      )}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        open={!!removing}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its sign-in folder goes to the Recycle Bin, so you can restore it.
              {engine.active === removing?.id
                ? ` ${engine.label} agents go back to this computer's sign-in.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) remove.mutate(removing);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsOptionGroup>
  );
}

/** Settings → AI accounts: the subscriptions the agents run on. */
export function AiAccountsSettingsCard() {
  const accounts = useQuery({
    queryKey: LIST_KEY,
    queryFn: listAiAccounts,
    // Picks up a sign-in finished in the terminal.
    refetchInterval: 5_000,
  });

  return (
    <section className="min-w-0" data-testid="settings-ai-accounts">
      <SettingsSectionHeader
        description="The Claude, ChatGPT and Google subscriptions your agents run on. Add more accounts, see their usage, and switch which one the agents use."
        title="AI accounts"
      />
      {accounts.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Looking for your accounts…
        </p>
      ) : accounts.error ? (
        <p className="text-sm text-destructive">
          {accounts.error instanceof Error
            ? accounts.error.message
            : "Couldn't read your accounts."}
        </p>
      ) : (
        <SettingsOptionGroupList>
          {(accounts.data ?? []).map((engine) => (
            <EngineGroup engine={engine} key={engine.engine} />
          ))}
        </SettingsOptionGroupList>
      )}
    </section>
  );
}

function ApiKeyInput({
  engine,
  onChange,
  value,
}: {
  engine: Engine;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Input
      aria-label="API key"
      autoComplete="off"
      className="max-w-sm flex-1 font-mono"
      data-testid="ai-account-api-key"
      onChange={(event) => onChange(event.target.value)}
      placeholder={API_KEY_HINT[engine]}
      spellCheck={false}
      type="password"
      value={value}
    />
  );
}
