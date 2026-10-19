import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/**
 * A new server on this computer: the app starts a relay for it (see
 * `local_servers.rs`), makes you its owner, then connects to it like any
 * other community.
 */
export function LocalServerCreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (relayUrl: string, name: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { data: available, isLoading } = useQuery({
    queryKey: ["local-servers-available"],
    queryFn: () => invoke<boolean>("local_servers_available"),
  });

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await invoke<{ name: string; relayUrl: string }>(
        "local_server_create",
        { name: value },
      );
      onCreated(created.relayUrl, created.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isLoading && available === false) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Servers on this computer need the local relay from the source
          checkout, which isn't set up here. You can still join a server you
          have the address of.
        </p>
        <div className="flex justify-end">
          <Button onClick={onCancel} variant="outline">
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3"
      data-testid="local-server-create"
      onSubmit={create}
    >
      <label
        className="grid gap-1.5 text-sm font-medium"
        htmlFor="local-server-name"
      >
        Name
        <Input
          autoFocus
          disabled={busy}
          id="local-server-name"
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Race Cafe"
          value={name}
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button
          disabled={busy}
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button disabled={!name.trim() || busy} type="submit">
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "Starting it…" : "Create server"}
        </Button>
      </div>
    </form>
  );
}
