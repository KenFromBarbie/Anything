import { ThemeGrainientBackground } from "@/app/ThemeGrainientBackground";
import { AppMark } from "@/shared/ui/AppMark";

/** Immediate feedback shown while the native huddle session is being prepared. */
export function HuddleStartingView() {
  return (
    <div
      aria-label="Starting call"
      className="buzz-setup-loading-shell flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 text-foreground"
      data-testid="huddle-starting-view"
      role="status"
    >
      <ThemeGrainientBackground />
      <span className="sr-only">Starting call</span>
      <AppMark className="relative z-10 h-24 w-24" loading />
    </div>
  );
}
