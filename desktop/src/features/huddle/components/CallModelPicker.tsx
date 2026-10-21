import * as React from "react";
import { ChevronDown } from "lucide-react";

import { listOfficeAgentsOnFloor } from "@/features/office/lib/meetingRoom";
import { callOffice } from "@/features/office/lib/officeLink";
import { invokeTauri } from "@/shared/api/tauri";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** What an Office agent answers with in calls unless another is picked. */
const CALL_DEFAULT_MODEL = "claude-sonnet-5-5";

type ModelOption = { id: string; label: string };
type HireOptions = {
  providers?: Array<{ id: string; models?: ModelOption[] }>;
};

/**
 * The model an Office agent answers with in calls, picked from the same
 * Claude models the Agents page offers (Sonnet 5.5 unless changed). Shown
 * only for Office agents; the next answer uses the new model.
 */
export function CallModelPicker({ agentPubkey }: { agentPubkey: string }) {
  const [office, setOffice] = React.useState(false);
  const [models, setModels] = React.useState<ModelOption[]>([]);
  const [current, setCurrent] = React.useState(CALL_DEFAULT_MODEL);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const onFloor = await listOfficeAgentsOnFloor().catch(() => []);
      const isOffice = onFloor.some(
        (a) => a.pubkey.toLowerCase() === agentPubkey.toLowerCase(),
      );
      if (cancelled || !isOffice) return;
      setOffice(true);
      const [options, picked] = await Promise.all([
        callOffice<HireOptions>("hire.options").catch(() => null),
        invokeTauri<Record<string, string>>("get_call_models").catch(
          () => ({}) as Record<string, string>,
        ),
      ]);
      if (cancelled) return;
      const claude =
        options?.providers?.find((p) => p.id === "claude")?.models ?? [];
      const list = claude.some((m) => m.id === CALL_DEFAULT_MODEL)
        ? claude
        : [{ id: CALL_DEFAULT_MODEL, label: "Sonnet 5.5" }, ...claude];
      setModels(list);
      setCurrent(picked[agentPubkey.toLowerCase()] ?? CALL_DEFAULT_MODEL);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentPubkey]);

  if (!office) return null;

  const label =
    models.find((m) => m.id === current)?.label ?? current.replace(/^claude-/, "");

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium">Answers with</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Choose the model this agent answers with in calls"
            className="h-8 shrink-0 gap-1.5 px-2 text-sm text-muted-foreground"
            data-testid="huddle-agent-model-selector"
            disabled={busy || models.length === 0}
            size="sm"
            type="button"
            variant="ghost"
          >
            {label}
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-72 min-w-44 overflow-y-auto"
        >
          <DropdownMenuRadioGroup
            onValueChange={(model) => {
              setBusy(true);
              setCurrent(model);
              void invokeTauri("set_call_model", { agentPubkey, model })
                .catch((error) =>
                  console.error("Failed to set the call model:", error),
                )
                .finally(() => setBusy(false));
            }}
            value={current}
          >
            {models.map((model) => (
              <DropdownMenuRadioItem key={model.id} value={model.id}>
                {model.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
