// Builds the Munder Difflin UI for a non-Electron webview (Buzz's Tauri window
// or a plain browser), talking to the headless sidecar. Same renderer, same
// preload; only `electron` is swapped for the WebSocket shim.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  root: resolve(__dirname, 'src/sidecar-web'),
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  resolve: {
    alias: {
      electron: resolve(__dirname, 'src/sidecar-web/electron-renderer-shim.ts'),
      '@': resolve(__dirname, 'src/renderer/src'),
      '@brand': resolve(__dirname, 'docs'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: { port: 5199, strictPort: true, host: '127.0.0.1', fs: { allow: [__dirname] } },
  build: { outDir: resolve(__dirname, 'out/sidecar-web'), emptyOutDir: true, target: 'es2022' }
});
