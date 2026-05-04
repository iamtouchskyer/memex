// Bundle src/cli.ts → dist/cli.js as a single self-contained file with a
// node shebang. All runtime deps are inlined so the Claude Code plugin
// consumer can `git clone` this repo and run `node dist/cli.js` without
// `npm install`. Assets (share-card, serve-ui.html) are still copied by
// postbuild.mjs.
import { build } from "esbuild";
import { chmodSync, rmSync, mkdirSync } from "node:fs";

// Clean dist/ first so leftover tsc output (commands/, importers/, .d.ts
// files) doesn't pollute the bundle directory.
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.js",
  sourcemap: true,
  // src/cli.ts already has #!/usr/bin/env node on line 1. In ESM mode we
  // also need `require` available for bundled deps that internally use CJS.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  // node-llama-cpp is optional (dynamic import with try/catch) — keep it
  // and its native platform binaries external so bundling doesn't need the
  // full 34MB package and CUDA/Metal binaries tree. If users want local
  // embeddings, they can `npm install -g node-llama-cpp` separately.
  external: ["node-llama-cpp", "@node-llama-cpp/*"],
  logLevel: "info",
});

chmodSync("dist/cli.js", 0o755);
console.log("bundled dist/cli.js (self-contained, executable)");
