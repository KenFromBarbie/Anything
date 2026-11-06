import * as React from "react";

import type { Community } from "@/features/communities/types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/** True once the typed name is the community's name, as Discord asks. */
export function deleteNameMatches(typed: string, name: string): boolean {
  return typed.trim() !== "" && typed.trim() === name.trim();
}

/**
 * Delete a server from Anything: the owner types its name to confirm, then
 * their membership is ended and the server is removed from the app. The relay
 * itself is hosted elsewhere, so its messages stay there.
 */
export function DeleteCommunityDialog({
  community,
  onDelete,
  onOpenChange,
}: {
  community: Community | null;
  onDelete: (id: string) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (community) {
      setTyped("");
      setError(null);
      setPending(false);
    }
  }, [community]);

  const matches = community ? deleteNameMatches(typed, community.name) : false;

  const confirm = async () => {
    if (!community || !matches || pending) return;
    setPending(true);
    setError(null);
    try {
      await onDelete(community.id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
      open={community !== null}
    >
      <AlertDialogContent data-testid="delete-community-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete '{community?.name}'</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <strong className="text-foreground">{community?.name}</strong>? It
            is removed from Anything and your membership ends. This can't be
            undone here; its messages stay on its relay ({community?.relayUrl}
            ).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label
            className="text-xs font-semibold uppercase text-muted-foreground"
            htmlFor="delete-community-name"
          >
            Enter server name
          </label>
          <Input
            autoComplete="off"
            autoFocus
            data-testid="delete-community-name"
            disabled={pending}
            id="delete-community-name"
            onChange={(event) => setTyped(event.target.value)}
            spellCheck={false}
            value={typed}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button disabled={pending} type="button" variant="outline">
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            data-testid="delete-community-confirm"
            disabled={!matches || pending}
            onClick={() => void confirm()}
            type="button"
            variant="destructive"
          >
            {pending ? "Deleting…" : "Delete server"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
