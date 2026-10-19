import * as React from "react";

import type { AddCommunityPrefillRequest } from "@/features/communities/addCommunityPrefill";
import { LocalServerCreateForm } from "@/features/communities/ui/LocalServerCreateForm";
import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { InviteRedeemForm } from "@/features/onboarding/ui/InviteRedeemForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

type AddCommunityDialogProps = {
  prefill?: AddCommunityPrefillRequest | null;
  onSubmit?: (
    community: import("@/features/communities/types").Community,
  ) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Servers are created on this computer; joining is only for invite links
 *  opened from elsewhere (they prefill the address). */
type AddCommunityMode = "create" | "join";

export function AddCommunityDialog({
  prefill,
  open,
  onOpenChange,
}: AddCommunityDialogProps) {
  const communityOnboarding = useCommunityOnboarding();
  const [mode, setMode] = React.useState<AddCommunityMode>("create");
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const appliedPrefillId = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!prefill || appliedPrefillId.current === prefill.requestId) return;
    appliedPrefillId.current = prefill.requestId;
    setJoinError(null);
    setMode("join");
  }, [prefill]);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
    setMode("create");
    setJoinError(null);
  }, [onOpenChange]);

  const startConnection = React.useCallback(
    ({
      relayUrl,
      inviteCode,
      policyReceipt,
    }: {
      relayUrl: string;
      inviteCode?: string;
      policyReceipt?: string;
    }) => {
      const started = communityOnboarding.start({
        source: "add-community",
        relayUrl,
        inviteCode,
        communityName: prefill?.name,
        policyReceipt,
      });
      if (!started) {
        setJoinError(
          "Finish connecting the community already in progress, then try again.",
        );
        return;
      }
      handleClose();
    },
    [communityOnboarding, handleClose, prefill?.name],
  );

  const title =
    mode === "create" ? "Create a server" : "Join an existing community";

  const description =
    mode === "create"
      ? "It runs on this computer, with its own channels and its own Office."
      : "Use the community URL or invite link you received.";

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
        else onOpenChange(true);
      }}
      open={open}
    >
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        data-testid="add-community-dialog"
      >
        <DialogHeader className="px-6 pb-3 pt-5 pr-14">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="truncate">{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 pt-3">
          {mode === "join" ? (
            <InviteRedeemForm
              error={joinError}
              initialValue={prefill?.relayUrl}
              isRedeeming={false}
              key={prefill?.requestId ?? "manual-add-community"}
              onCancel={handleClose}
              onConnect={(relayUrl) => startConnection({ relayUrl })}
              onRedeem={(relayUrl, inviteCode, policyReceipt) =>
                startConnection({ relayUrl, inviteCode, policyReceipt })
              }
              variant="add-community"
            />
          ) : (
            <LocalServerCreateForm
              onCancel={handleClose}
              onCreated={(relayUrl, name) => {
                const started = communityOnboarding.start({
                  source: "add-community",
                  relayUrl,
                  communityName: name,
                });
                if (!started) {
                  throw new Error(
                    "Finish connecting the community already in progress, then try again.",
                  );
                }
                handleClose();
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
