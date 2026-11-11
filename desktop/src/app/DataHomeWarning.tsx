import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TriangleAlert } from "lucide-react";

type Mismatch = { expected: string; actual: string; agents_then: number; agents_now: number };

/**
 * Shown when this start is looking at a different (emptier) data folder than
 * the app last used: e.g. it was started from outside the app it's normally
 * started from, so Windows shows it another copy of AppData. Without this the
 * app looks like a fresh install and the owner sets it up again over nothing.
 */
export function DataHomeWarning() {
  const [mismatch, setMismatch] = React.useState<Mismatch | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!isTauri()) return;
    invoke<Mismatch | null>("data_home_status").then(setMismatch, () => undefined);
  }, []);

  if (!mismatch) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/95 p-6 backdrop-blur" data-testid="data-home-warning" role="alertdialog">
      <div className="w-full max-w-xl rounded-xl border bg-card p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <TriangleAlert className="h-5 w-5 text-amber-500" />
          Anything opened a different data folder
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Your data is not lost. This start is looking at a folder with {mismatch.agents_now} agent{mismatch.agents_now === 1 ? "" : "s"}; the one you normally use has {mismatch.agents_then}. That usually means Anything was started a different way than usual (for example from another app, or by double-click instead of from it).
        </p>
        <dl className="mb-4 space-y-2 rounded-lg bg-muted/50 p-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Your data is here</dt>
            <dd className="break-all font-mono">{mismatch.expected}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">This start is looking here</dt>
            <dd className="break-all font-mono">{mismatch.actual}</dd>
          </div>
        </dl>
        <p className="mb-4 text-sm">Close Anything and start it the way you normally do. Nothing has been created or changed.</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirming ? (
            <>
              <span className="mr-auto text-xs text-muted-foreground">Start fresh in this folder? Your other data stays where it is.</span>
              <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setConfirming(false)} type="button">
                Cancel
              </button>
              <button
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                onClick={() => void invoke("data_home_accept").then(() => setMismatch(null))}
                type="button"
              >
                Yes, use this folder
              </button>
            </>
          ) : (
            <>
              <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setConfirming(true)} type="button">
                Use this folder from now on
              </button>
              <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90" onClick={() => void getCurrentWindow().close()} type="button">
                Close Anything
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
