import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useStudioActions,
  useStudioStatus,
} from "@/features/studio/lib/studioInstall";
import { StudioInstallCard } from "@/features/studio/ui/StudioScreen";
import { StudioToolPicker } from "@/features/studio/ui/StudioToolPicker";
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

import { SettingsOptionGroup } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

/** Settings → Studio: install it, choose its tools, update or remove it. */
export function StudioSettingsCard() {
  const { data: status, isLoading } = useStudioStatus();
  const { setTools, install, uninstall } = useStudioActions();
  const [tools, setLocalTools] = React.useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  React.useEffect(() => {
    if (status) setLocalTools(status.tools);
  }, [status]);

  const changed =
    !!status &&
    (tools.length !== status.tools.length ||
      tools.some((t) => !status.tools.includes(t)));
  const outdated =
    !!status?.installed &&
    !status.devBuild &&
    status.version !== null &&
    status.version !== status.appVersion;
  const onError = (e: unknown) => toast.error(String(e));

  return (
    <div className="grid gap-6" data-testid="studio-settings">
      <SettingsSectionHeader
        description="The Studio's local creative tools are an optional download. Choose which tools are installed, update them with the app, or remove the Studio."
        title="Studio"
      />
      {isLoading || !status ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking the Studio…
        </p>
      ) : !status.installed ? (
        <StudioInstallCard initialTools={status.tools} />
      ) : (
        <>
          <SettingsOptionGroup
            description={
              status.devBuild
                ? "A local development build of the Studio is in use."
                : `Installed for version ${status.version ?? status.appVersion}.`
            }
            title="Tools"
          >
            <div className="grid gap-3 px-4 py-3">
              <StudioToolPicker
                disabled={setTools.isPending}
                onChange={setLocalTools}
                value={tools}
              />
              <p className="text-xs text-muted-foreground">
                The tools share one download, so changing them doesn't download
                anything; they appear or disappear the next time the Studio
                opens.
              </p>
              <div className="flex gap-2">
                <Button
                  data-testid="studio-save-tools"
                  disabled={
                    !changed || tools.length === 0 || setTools.isPending
                  }
                  onClick={() =>
                    setTools.mutate(tools, {
                      onSuccess: () => toast.success("Studio tools updated."),
                      onError,
                    })
                  }
                  size="sm"
                >
                  {setTools.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : null}
                  Save tools
                </Button>
                {changed ? (
                  <Button
                    onClick={() => setLocalTools(status.tools)}
                    size="sm"
                    variant="ghost"
                  >
                    Undo
                  </Button>
                ) : null}
              </div>
            </div>
          </SettingsOptionGroup>
          {!status.devBuild ? (
            <SettingsOptionGroup title="Installation">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                {outdated ? (
                  <Button
                    disabled={install.isPending}
                    onClick={() =>
                      install.mutate(status.tools, {
                        onSuccess: () => toast.success("Studio updated."),
                        onError,
                      })
                    }
                    size="sm"
                  >
                    {install.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    Update to {status.appVersion}
                  </Button>
                ) : null}
                <Button
                  data-testid="studio-uninstall"
                  disabled={uninstall.isPending}
                  onClick={() => setConfirmRemove(true)}
                  size="sm"
                  variant="outline"
                >
                  <Trash2 />
                  Remove the Studio
                </Button>
              </div>
            </SettingsOptionGroup>
          ) : null}
        </>
      )}
      <AlertDialog onOpenChange={setConfirmRemove} open={confirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the Studio?</AlertDialogTitle>
            <AlertDialogDescription>
              Its files go to the Recycle Bin (Trash on Mac and Linux). Your
              Studio projects and library are kept. You can install it again any
              time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                uninstall.mutate(undefined, {
                  onSuccess: () => toast("The Studio was removed."),
                  onError,
                })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
