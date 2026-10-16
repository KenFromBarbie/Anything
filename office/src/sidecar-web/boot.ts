/**
 * Boots the Munder Difflin UI against the headless sidecar: connect first, then
 * run the unmodified preload (which builds window.cth over the shim), then the
 * unmodified renderer.
 */
import { connectSidecar } from './electron-renderer-shim';

async function boot(): Promise<void> {
  await connectSidecar();
  await import('../preload/index');
  await import('../renderer/src/main');
}

boot().catch((err) => {
  console.error('[office] boot failed', err);
  const hint = document.querySelector('#cth-splash .hint');
  if (hint) hint.textContent = `could not reach the office backend: ${err?.message ?? err}`;
});
