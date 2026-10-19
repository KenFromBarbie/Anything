/**
 * The Office floor behind the whole window is a second, draw-only Office
 * frame (the "mirror", see OfficeBackdrop). The main Office frame broadcasts
 * the floor's state; this relays it to the mirror, and asks the main frame for
 * a fresh copy when the mirror (re)loads. Same-origin frames, so plain
 * postMessage with the app's origin.
 */

let mirror: Window | null = null;
let lastSnapshot: unknown = null;
let askMain: (() => void) | null = null;

function send(snapshot: unknown) {
  mirror?.postMessage(
    { source: "buzz-office-host", type: "mirror", snapshot },
    window.location.origin,
  );
}

/** The main frame's latest floor state, passed on to the mirror. */
export function relayToMirror(snapshot: unknown): void {
  lastSnapshot = snapshot;
  send(snapshot);
}

/** The main frame, able to send a fresh snapshot on request. */
export function setMirrorSource(request: (() => void) | null): void {
  askMain = request;
}

/** The mirror frame's window (null when it goes away). */
export function setMirrorTarget(target: Window | null): void {
  mirror = target;
  if (target) {
    if (lastSnapshot) send(lastSnapshot);
    askMain?.();
  }
}
