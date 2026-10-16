import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart Kenn’s Harness to finish recovery"
      body="Your identity was updated. Kenn’s Harness needs to restart so syncing and agents run under it."
    />
  );
}
