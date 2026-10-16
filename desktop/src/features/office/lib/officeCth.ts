import { callOffice } from "@/features/office/lib/officeLink";

/** One of the Office's own data calls (the allowlist in the Office's
 *  `host/buzzSectionsApi`), with positional arguments. */
export function officeCth<T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  return callOffice<T>("cth", { method, args });
}

/** "12k", "1.4M": compact token counts. */
export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** "3m ago" / "in 2h" style relative time from a millisecond delta. */
export function relTime(deltaMs: number): string {
  const past = deltaMs >= 0;
  const a = Math.abs(deltaMs);
  if (a < 45_000) return "just now";
  const mins = Math.round(a / 60_000);
  const unit =
    mins < 60
      ? `${mins}m`
      : mins < 1440
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / 1440)}d`;
  return past ? `${unit} ago` : `in ${unit}`;
}
