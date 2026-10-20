import { AppMark } from "@/shared/ui/AppMark";

/** Loading screens: the app's mark, floating (once Buzz's flapping bee). */
export function FlappingBee({ className }: { className?: string }) {
  return <AppMark className={className} loading />;
}
