import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { SegmentedControl } from "@/shared/ui/segmented-control";
import {
  SettingsOptionGroup,
  SettingsOptionGroupList,
  SettingsOptionRow,
} from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { VoiceSettingsCard } from "./VoiceSettingsCard";

/** How long you can pause before your turn in a call ends (Rust:
 *  `huddle/meeting_pause.rs`). */
const PAUSE_OPTIONS = [
  { value: "800", label: "Short", description: "0.8 s: quick back-and-forth" },
  { value: "1200", label: "Normal", description: "1.2 s: room for a breath" },
  { value: "2000", label: "Long", description: "2 s: think while you talk" },
] as const;
type PauseValue = (typeof PAUSE_OPTIONS)[number]["value"];

function nearest(ms: number): PauseValue {
  return PAUSE_OPTIONS.reduce((best, option) =>
    Math.abs(Number(option.value) - ms) < Math.abs(Number(best.value) - ms)
      ? option
      : best,
  ).value;
}

export function MeetingSettingsCard() {
  const [pause, setPause] = React.useState<PauseValue>("1200");

  React.useEffect(() => {
    void invoke<{ pauseMs: number }>("meeting_settings_get")
      .then((s) => setPause(nearest(s.pauseMs)))
      .catch(() => {});
  }, []);

  const choose = async (value: PauseValue) => {
    const previous = pause;
    setPause(value);
    try {
      await invoke("meeting_settings_set_pause", { pauseMs: Number(value) });
    } catch (e) {
      setPause(previous);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const active =
    PAUSE_OPTIONS.find((o) => o.value === pause) ?? PAUSE_OPTIONS[1];

  return (
    <section className="min-w-0" data-testid="settings-meetings">
      <SettingsSectionHeader
        title="Meetings"
        description="Calls in the meeting room and with agents."
      />
      <SettingsOptionGroupList>
        <SettingsOptionGroup>
          <SettingsOptionRow data-testid="meeting-pause-row">
            <div className="min-w-0">
              <p className="text-sm font-medium">Pause before your turn ends</p>
              <p
                className="text-sm font-normal text-muted-foreground/70"
                data-settings-subcopy
              >
                How long you can stop talking before what you said is sent.{" "}
                {active.description}.
              </p>
            </div>
            <SegmentedControl
              legend="Pause before your turn ends"
              onValueChange={(value) => void choose(value as PauseValue)}
              optionTestIdPrefix="meeting-pause"
              options={PAUSE_OPTIONS.map(({ value, label }) => ({
                value,
                label,
              }))}
              size="compact"
              testId="meeting-pause-control"
              value={pause}
            />
          </SettingsOptionRow>
        </SettingsOptionGroup>
      </SettingsOptionGroupList>
      <div className="mt-12">
        <VoiceSettingsCard />
      </div>
    </section>
  );
}
