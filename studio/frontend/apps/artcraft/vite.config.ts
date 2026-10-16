import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { resolve } from "node:path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// NB(bt): This configuration file can specify bundler rollup options, compiler plugins,
// import path resolution, dev server HTTP headers, CORS options, path rewriting, etc.
// Read the vite docs for more: https://vitejs.dev/config/

const SPARK_MODULE_SUBPATH = "/@sparkjsdev/spark/dist/spark.module.js";
const SPARK_WASM_PATTERN =
  /module_or_path = new URL\("(data:application\/wasm;base64,[^"]+)", import\.meta\.url\);/;

const sparkWasmDataUrlFix = (): Plugin => ({
  name: "spark-wasm-data-url-fix",
  enforce: "pre",
  apply: "serve",
  transform(code, id) {
    if (!id.includes(SPARK_MODULE_SUBPATH)) {
      return null;
    }

    const match = code.match(SPARK_WASM_PATTERN);
    if (!match) {
      return null;
    }

    const [, dataUrl] = match;
    const patched = code.replace(
      SPARK_WASM_PATTERN,
      `module_or_path = "${dataUrl}";`,
    );

    return {
      code: patched,
      map: null,
    };
  },
});

// Serving ArtCraft under a subpath (e.g. Buzz's Studio at /studio-app/): set
// ARTCRAFT_BASE. Vite prefixes bundled assets itself; code also refers to the
// public folders by absolute path ("/resources/..."), which this prefixes too.
const BASE = process.env.ARTCRAFT_BASE || "/";
const PUBLIC_PATH_DIRS = ["resources", "jsm", "images", "fonts"];

const publicPathsUnderBase = (base: string): Plugin => ({
  name: "artcraft-public-paths-under-base",
  enforce: "pre",
  transform(code, id) {
    const file = id.split("?")[0];
    if (file.includes("node_modules") || !/\.[cm]?[jt]sx?$/.test(file)) {
      return null;
    }
    const absolute = new RegExp(`(["'\`])/(${PUBLIC_PATH_DIRS.join("|")})/`, "g");
    if (!absolute.test(code)) {
      return null;
    }
    return { code: code.replace(absolute, `$1${base}$2/`), map: null };
  },
});

const projectRoot = __dirname;
const appRoot = path.resolve(projectRoot, "app");
const workspaceRoot = path.resolve(projectRoot, "..", "..");

export default defineConfig({
  root: appRoot,
  base: BASE,
  optimizeDeps: {
    exclude: ["@sparkjsdev/spark"],
  },
  build: {
    outDir: path.resolve(projectRoot, "dist"),
    rollupOptions: {
      input: {
        index: resolve(projectRoot, "app/index.html"),
      },
    },
  },
  plugins: [
    react(),
    sparkWasmDataUrlFix(),
    tsconfigPaths({
      // Resolve workspace packages to source for every importer, including shared
      // libraries. Fresh release checkouts have no prebuilt library dist files.
      projects: [path.resolve(workspaceRoot, "tsconfig.base.json")],
    }),
    wasm(),
    topLevelAwait(),
    ...(BASE === "/" ? [] : [publicPathsUnderBase(BASE)]),
  ],
  server: {
    fs: {
      allow: [workspaceRoot],
    },
  },
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@preact/signals-core",
      "@preact/signals-react"
    ],
  },
});
