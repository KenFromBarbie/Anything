import { AppMark } from "@/shared/ui/AppMark";

/**
 * The app's mark, static. Kept under its old name so every place that showed
 * Buzz's mark (onboarding, runtime and repository icons, link previews) shows
 * Anything's instead.
 */
export function BuzzMark({ className }: { className?: string }) {
  return <AppMark className={className} />;
}
