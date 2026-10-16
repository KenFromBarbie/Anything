import type * as React from "react";

import { cn } from "@/shared/lib/cn";
import { SectionHeader } from "@/shared/ui/PageHeader";

/** A titled card: one block of an agent section. */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  testId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn(
        "grid gap-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-xs",
        className,
      )}
      data-testid={testId}
    >
      <SectionHeader action={action} description={description} title={title} />
      {children}
    </section>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** Monospace, scrollable text (memory files, search output). */
export function Pre({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/40 px-3 py-2 font-mono text-xs leading-5",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export const SECTION_SELECT =
  "flex h-9 rounded-lg border border-input/40 bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

/** The error a failed Office call left, as a destructive callout. */
export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
