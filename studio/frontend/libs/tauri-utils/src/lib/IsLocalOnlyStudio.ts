/**
 * True when ArtCraft runs as Kenn's Harness's Studio: only the tools that work
 * on this computer are offered, and nothing that spends ArtCraft's AI credits
 * (cloud image, video, audio and 3D generation, inpainting, background
 * removal) is shown or can be started.
 */
export function IsLocalOnlyStudio(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as { __ARTCRAFT_EMBEDDED__?: boolean }).__ARTCRAFT_EMBEDDED__ === true
  );
}

/** The message shown if a credit-spending action is reached anyway. */
export const LOCAL_ONLY_MESSAGE =
  "AI generation is turned off in the Studio: it uses paid ArtCraft credits.";
