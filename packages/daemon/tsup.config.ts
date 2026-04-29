import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    outExtension({ format }) {
      return { js: format === "esm" ? ".mjs" : ".cjs" };
    },
  },
  {
    entry: { daemon: "src/daemon.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    // Bundle all dependencies so daemon.mjs is fully self-contained —
    // no node_modules needed at runtime inside the agent container.
    noExternal: [/.*/],
    outDir: "dist",
    outExtension() {
      return { js: ".mjs" };
    },
  },
]);
