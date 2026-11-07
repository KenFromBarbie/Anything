import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { callOffice } from "@/features/office/lib/officeLink";
import { Switch } from "@/shared/ui/switch";

import { SettingsOptionRow } from "./SettingsOptionGroup";

type RestoreSettings = { always: boolean };
const KEY = ["office", "restore-settings"];

/** Bring the whole team back when the app opens. Off by default: only a team
 *  of 3 or fewer comes back on its own, since each agent is a ~200 MB process;
 *  a larger team waits under Office → Restore team. */
export function RestoreTeamSetting() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => callOffice<RestoreSettings>("restore.settings"),
  });
  const save = useMutation({
    mutationFn: (always: boolean) =>
      callOffice<RestoreSettings>("restore.setAlways", { always }),
    onSuccess: (value) => queryClient.setQueryData(KEY, value),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });
  return (
    <SettingsOptionRow data-testid="office-restore-always-row">
      <div className="min-w-0">
        <label
          className="text-sm font-medium"
          htmlFor="office-restore-always-switch"
        >
          Always restore the team
        </label>
        <p
          className="text-sm font-normal text-muted-foreground/70"
          data-settings-subcopy
        >
          When the app opens, bring back every agent from the last session, two
          at a time. Each one uses about 200 MB while it runs. Off: a larger
          team waits under Office → Restore team for you to pick.
        </p>
      </div>
      <Switch
        checked={
          save.isPending
            ? save.variables === true
            : settings.data?.always === true
        }
        data-testid="office-restore-always-toggle"
        disabled={settings.isPending || settings.isError || save.isPending}
        id="office-restore-always-switch"
        onCheckedChange={(next) => save.mutate(next)}
      />
    </SettingsOptionRow>
  );
}
