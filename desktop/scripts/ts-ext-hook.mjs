// Lets `node --test` load the app's TS modules that import siblings without
// an extension (`./modelFormat`), as Vite and tsc allow:
//   node --import ./scripts/ts-ext-hook.mjs --test src/features/office/editors/cad.test.mjs
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.startsWith("file:")) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
});
