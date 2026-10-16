/**
 * Buzz colors for an Office agent's accent ("sky", "lemon", …): a solid dot or
 * avatar, and a soft tint for selected surfaces.
 */
const ACCENTS: Record<string, { solid: string; soft: string; fill: string }> = {
  coral: {
    solid: "bg-rose-400 text-white",
    soft: "bg-rose-400/15",
    fill: "fill-rose-400",
  },
  mint: {
    solid: "bg-emerald-400 text-white",
    soft: "bg-emerald-400/15",
    fill: "fill-emerald-400",
  },
  sky: {
    solid: "bg-sky-400 text-white",
    soft: "bg-sky-400/15",
    fill: "fill-sky-400",
  },
  lemon: {
    solid: "bg-amber-400 text-black",
    soft: "bg-amber-400/15",
    fill: "fill-amber-400",
  },
  lilac: {
    solid: "bg-violet-400 text-white",
    soft: "bg-violet-400/15",
    fill: "fill-violet-400",
  },
  peach: {
    solid: "bg-orange-300 text-black",
    soft: "bg-orange-300/20",
    fill: "fill-orange-300",
  },
};
const FALLBACK = {
  solid: "bg-muted-foreground text-background",
  soft: "bg-muted",
  fill: "fill-muted-foreground",
};

export function accentClasses(accent: string | undefined) {
  return (accent && ACCENTS[accent]) || FALLBACK;
}

/** A dot in the agent's color. */
export function accentDotClass(accent: string | undefined): string {
  return accentClasses(accent).solid.split(" ")[0];
}
