export const ONBOARDING_CARD_INPUT_CLASS =
  "h-12 rounded-xl border-border bg-background/70 px-4 text-foreground shadow-none transition-[border-color,box-shadow] duration-200 ease-out placeholder:text-muted-foreground placeholder:opacity-70 hover:border-foreground/25 focus-visible:border-primary/70 focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.18)] motion-reduce:transition-none";

/** Quiet card actions share the same translucent neutral surface as Back. */
export const ONBOARDING_CARD_NEUTRAL_SURFACE_CLASS = "bg-foreground/[0.06]";

export const ONBOARDING_CARD_SECONDARY_CTA_CLASS = `${ONBOARDING_CARD_NEUTRAL_SURFACE_CLASS} text-foreground hover:bg-foreground/10 hover:text-foreground`;
