import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
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
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";

/** True once the typed name is the community's name, as Discord asks. */
export function deleteNameMatches(typed: string, name: string): boolean {
  return typed.trim() !== "" && typed.trim() === name.trim();
}

/** A server this app runs on this computer, and whether its data can be
 *  erased here; null for one hosted elsewhere. */
type LocalServerInfo = { erasable: boolean } | null;

/**
 * Delete a server: the owner types its name to confirm.
 *
 * A server this app runs on this computer is stopped and forgotten, so it
 * never starts again; ticking "erase" also deletes its messages, channels and
 * members through the relay's own deletion engine. A server hosted elsewhere
 * can only be left: the membership ends and it leaves the app, while its
 * relay keeps its messages.
 */
export function DeleteCommunityDialog({
  community,
  onDelete,
  onOpenChange,
}: {
  community: Community | null;
  onDelete: (id: string, options?: { leave?: boolean }) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = React.useState("");
  const [erase, setErase] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (community) {
      setTyped("");
      setErase(false);
      setError(null);
      setPending(false);
    }
  }, [community]);

  const local = useQuery({
    queryKey: ["local-server-info", community?.relayUrl],
    queryFn: () =>
      invoke<LocalServerInfo>("local_server_info", {
        relayUrl: community?.relayUrl ?? "",
      }),
    enabled: community !== null,
    staleTime: 0,
  });
  const info = local.data ?? null;

  const matches = community ? deleteNameMatches(typed, community.name) : false;

  const confirm = async () => {
    if (!community || !matches || pending || local.isPending) return;
    setPending(true);
    setError(null);
    try {
      if (info) {
        await invoke("local_server_delete", {
          relayUrl: community.relayUrl,
          erase: erase && info.erasable,
        });
        await onDelete(community.id, { leave: false });
      } else {
        await onDelete(community.id);
      }
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
            <strong className="text-foreground">{community?.name}</strong>?{" "}
            {info
              ? "It runs on this computer: it's stopped, removed from Anything and never started again."
              : `It's removed from Anything and your membership ends. Its messages stay on its relay (${community?.relayUrl ?? ""}).`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          {info ? (
            <div className="flex items-start gap-2">
              <Checkbox
                checked={erase}
                data-testid="delete-community-erase"
                disabled={pending || !info.erasable}
                id="delete-community-erase"
                onCheckedChange={(value) => setErase(value === true)}
              />
              <label
                className="grid gap-0.5 text-sm leading-snug"
                htmlFor="delete-community-erase"
              >
                <span className="font-medium">
                  Also erase its messages, channels and members
                </span>
                <span className="text-xs text-muted-foreground">
                  {info.erasable
                    ? "Permanent: they can't be brought back. Left unticked, the data stays in this computer's database, out of sight."
                    : "Not available here: the relay's deletion tool (buzz-admin) isn't on this computer."}
                </span>
              </label>
            </div>
          ) : null}
          <div className="grid gap-2">
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
          </div>
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
            disabled={!matches || pending || local.isPending}
            onClick={() => void confirm()}
            type="button"
            variant="destructive"
          >
            {pending
              ? erase
                ? "Erasing…"
                : "Deleting…"
              : erase
                ? "Delete and erase"
                : "Delete server"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
