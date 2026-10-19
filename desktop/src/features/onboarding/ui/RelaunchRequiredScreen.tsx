import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart Anything to finish recovery"
      body="Your identity was updated. Anything needs to restart so syncing and agents run under it."
    />
  );
}
