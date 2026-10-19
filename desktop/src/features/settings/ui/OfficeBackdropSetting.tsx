import {
  BACKDROP_STRENGTH_MAX,
  BACKDROP_STRENGTH_MIN,
  DEFAULT_BACKDROP_STRENGTH,
  setOfficeBackdrop,
  useOfficeBackdrop,
} from "@/features/office/lib/officeBackdrop";
import { AvatarFramingSlider } from "@/features/profile/ui/AnimatedAvatarControls";
import { Switch } from "@/shared/ui/switch";

import { SettingsOptionRow } from "./SettingsOptionGroup";

/** The Office floor behind the app: on/off, and how strongly it shows. */
export function OfficeBackdropSetting() {
  const { enabled, strength } = useOfficeBackdrop();
  return (
    <>
      <SettingsOptionRow data-testid="office-backdrop-row">
        <div className="min-w-0">
          <label
            className="text-sm font-medium"
            htmlFor="office-backdrop-switch"
          >
            Office background
          </label>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            The live Office floor, faded behind every page. View only: clicks
            always go to the page. Turning it on starts the Office with the app.
          </p>
        </div>
        <Switch
          checked={enabled}
          data-testid="office-backdrop-toggle"
          id="office-backdrop-switch"
          onCheckedChange={(next) => setOfficeBackdrop({ enabled: next })}
        />
      </SettingsOptionRow>
      {enabled ? (
        <SettingsOptionRow data-testid="office-backdrop-strength-row">
          <div className="min-w-0">
            <p className="text-sm font-medium">Background strength</p>
            <p
              className="text-sm font-normal text-muted-foreground/70"
              data-settings-subcopy
              id="office-backdrop-strength-description"
            >
              Higher values show more of the floor through the page.
            </p>
          </div>
          <div className="flex w-64 shrink-0 items-center">
            <AvatarFramingSlider
              ariaDescribedBy="office-backdrop-strength-description"
              ariaLabel="Office background strength"
              ariaValueText={`${strength}%`}
              compact
              handleAlwaysVisible
              max={BACKDROP_STRENGTH_MAX}
              min={BACKDROP_STRENGTH_MIN}
              onChange={(value) => setOfficeBackdrop({ strength: value })}
              onReset={() =>
                setOfficeBackdrop({ strength: DEFAULT_BACKDROP_STRENGTH })
              }
              resetLabel="Reset background strength"
              resetTestId="office-backdrop-strength-reset"
              resetValue={DEFAULT_BACKDROP_STRENGTH}
              testId="office-backdrop-strength-slider"
              value={strength}
            />
          </div>
        </SettingsOptionRow>
      ) : null}
    </>
  );
}
