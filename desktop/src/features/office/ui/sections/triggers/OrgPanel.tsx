import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { officeCth } from "@/features/office/lib/officeCth";
import { callOffice } from "@/features/office/lib/officeLink";
import { Switch } from "@/shared/ui/switch";

import { Muted } from "../SectionBits";
import { SecretInput, type TrustMode, TrustSelect } from "./triggerBits";

type OrgConfig = { apiKey: string; enabled: boolean; mode: TrustMode };

/** Teammates' copies of the Office messaging yours (configuration only). */
export function OrgPanel() {
  const loaded = useQuery({
    queryKey: ["office", "org-trigger"],
    queryFn: () => officeCth<OrgConfig | null>("getOrgTrigger"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [cfg, setCfg] = React.useState<OrgConfig | null>(null);
  React.useEffect(() => {
    if (!cfg && loaded.data !== undefined) {
      setCfg(loaded.data ?? { apiKey: "", enabled: false, mode: "strict" });
    }
  }, [loaded.data, cfg]);

  if (!cfg) return <Muted>Loading…</Muted>;
  const apply = (next: OrgConfig, persist = true) => {
    setCfg(next);
    if (persist) {
      void callOffice("triggers.org.set", { config: next }).catch(
        (error: Error) => toast.error(error.message),
      );
    }
  };
  const hasKey = cfg.apiKey.trim().length > 0;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm">
          Accept messages from your organisation
        </span>
        <Switch
          aria-label="Accept organisation messages"
          checked={cfg.enabled}
          onCheckedChange={(enabled) => apply({ ...cfg, enabled })}
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Organisation key</span>
        <SecretInput
          onBlur={() => apply(cfg)}
          onChange={(apiKey) => apply({ ...cfg, apiKey }, false)}
          placeholder="Paste your key"
          value={cfg.apiKey}
        />
        <p className="text-xs text-muted-foreground">
          With an organisation key set, teammates can message your clone node:
          the copy of the Office running on your machine.
        </p>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Trust</span>
        <TrustSelect
          onChange={(mode) => apply({ ...cfg, mode })}
          value={cfg.mode}
        />
      </div>
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Settings only, for now. The organisation messaging service doesn't exist
        yet, so a key here starts no connection and nothing is sent or received.
      </p>
      {cfg.enabled && !hasKey ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          This is on with no key set, so no teammate can reach you yet.
        </p>
      ) : null}
    </div>
  );
}
