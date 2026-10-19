import { cn } from "@/shared/lib/cn";

/**
 * Anything's mark (the hammer-and-wrench app icon). `loading` lets it float
 * gently, for the app's loading screens.
 */
export function AppMark({
  className,
  loading = false,
  label,
}: {
  className?: string;
  loading?: boolean;
  label?: string;
}) {
  return (
    <img
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      className={cn("select-none", loading && "app-mark-loading", className)}
      draggable={false}
      src="/app-mark.svg"
    />
  );
}
