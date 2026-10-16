/**
 * True when ArtCraft runs inside a host app (Buzz's Studio) as a view in the
 * host's window, rather than in a window of its own. The host sets the flag
 * before any page script runs. Window chrome (minimize, maximize, close,
 * dragging) would act on the host's window there, so it is hidden.
 */
export function IsEmbeddedInHost(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as { __ARTCRAFT_EMBEDDED__?: boolean }).__ARTCRAFT_EMBEDDED__ === true
  );
}
