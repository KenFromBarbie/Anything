import { AppMark } from "@/shared/ui/AppMark";

export type FuzzyLogoProps = {
  /** Kept for callers; the app's mark has no texture variant. */
  fuzz?: boolean;
  className?: string;
  ariaLabel?: string;
  loop?: boolean;
  loopRestSeconds?: number;
  /** Set false when a parent drives its own opacity animation over the mark. */
  pulse?: boolean;
  reverse?: boolean;
  variant?: string;
};

/**
 * The animated mark for "working" and loading spots: Anything's mark,
 * floating (once Buzz's animated bee).
 */
export function FuzzyLogo({
  className,
  ariaLabel = "Anything",
  pulse = true,
}: FuzzyLogoProps) {
  return <AppMark className={className} label={ariaLabel} loading={pulse} />;
}
