import { RecoveryScreen } from "./RecoveryScreen";

export function ResetFailedScreen() {
  return (
    <RecoveryScreen
      testId="reset-failed"
      title="Sign out could not complete"
      body="Kenn’s Harness was unable to fully clear your local data. Try relaunching — the reset will resume automatically. If this persists, contact support."
    />
  );
}
