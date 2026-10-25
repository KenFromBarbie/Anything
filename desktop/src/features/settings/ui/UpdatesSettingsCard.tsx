import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  checkForUpdate,
  formatMegabytes,
  getUpdaterSettings,
  installUpdate,
  onUpdateProgress,
  setAutoUpdate,
  type UpdateInfo,
  type UpdateProgress,
} from "@/features/settings/lib/updater";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import { Switch } from "@/shared/ui/switch";
import {
  SettingsOptionGroup,
  SettingsOptionGroupList,
  SettingsOptionRow,
} from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

/**
 * Settings → Updates: this version, the latest release on GitHub, and a
 * button that installs it (the app restarts into the new version). Updating
 * by itself is off unless turned on here.
 */
export function UpdatesSettingsCard() {
  const [info, setInfo] = React.useState<UpdateInfo | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [installing, setInstalling] = React.useState(false);
  const [progress, setProgress] = React.useState<UpdateProgress | null>(null);
  const [auto, setAuto] = React.useState(false);

  const check = React.useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setInfo(await checkForUpdate());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    void check();
    void getUpdaterSettings()
      .then((s) => setAuto(s.auto))
      .catch(() => {});
  }, [check]);

  React.useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void onUpdateProgress(setProgress).then((unlisten) => {
      if (gone) unlisten();
      else stop = unlisten;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  const install = async () => {
    setInstalling(true);
    setProgress(null);
    try {
      await installUpdate();
      // On Linux with a .deb the system's installer takes over from here.
      toast("The installer is open: finish there, then restart Anything.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  const toggleAuto = async (on: boolean) => {
    setAuto(on);
    try {
      await setAutoUpdate(on);
    } catch (e) {
      setAuto(!on);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <section className="min-w-0" data-testid="settings-updates">
      <SettingsSectionHeader
        title="Updates"
        description="New versions come from the app's releases on GitHub."
      />
      <SettingsOptionGroupList>
        <SettingsOptionGroup>
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {info
                  ? info.available
                    ? `Version ${info.latest} is available`
                    : "You're up to date"
                  : checking
                    ? "Checking for updates…"
                    : "Updates"}
              </p>
              <p
                className="text-sm font-normal text-muted-foreground/70"
                data-settings-subcopy
              >
                {info ? `This is version ${info.current}.` : null}
                {error ? ` Couldn't check: ${error}` : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                disabled={checking || installing}
                onClick={() => void check()}
                size="sm"
                variant="outline"
              >
                {checking ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Check
              </Button>
              {info?.available && info.asset ? (
                <Button
                  data-testid="updates-install"
                  disabled={installing}
                  onClick={() => void install()}
                  size="sm"
                >
                  {installing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {installing
                    ? percent !== null
                      ? `Downloading ${percent}%`
                      : "Starting…"
                    : `Update (${formatMegabytes(info.size)})`}
                </Button>
              ) : null}
              {info?.available && !info.asset ? (
                <Button
                  onClick={() => void openUrl(info.url)}
                  size="sm"
                  variant="outline"
                >
                  <ExternalLink />
                  Download
                </Button>
              ) : null}
            </div>
          </SettingsOptionRow>
          {info?.available && info.notes.trim() ? (
            <div className="max-h-72 overflow-y-auto border-t border-border/60 px-4 py-3 text-sm">
              <Markdown className="leading-6" content={info.notes} />
            </div>
          ) : null}
          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="updates-auto-switch"
              >
                Update automatically
              </label>
              <p
                className="text-sm font-normal text-muted-foreground/70"
                data-settings-subcopy
              >
                When a new version is out, install it shortly after the app
                starts (you can say "Not now"). Off: you update from here.
              </p>
            </div>
            <Switch
              checked={auto}
              data-testid="updates-auto-toggle"
              id="updates-auto-switch"
              onCheckedChange={(on) => void toggleAuto(on)}
            />
          </SettingsOptionRow>
        </SettingsOptionGroup>
      </SettingsOptionGroupList>
    </section>
  );
}
