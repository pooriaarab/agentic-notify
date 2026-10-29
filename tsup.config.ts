import { defineConfig } from "tsup";

export default defineConfig({
  // Named entries, so `ui/embed.tsx` lands as `dist/ui.js` and its stylesheet as `dist/ui.css`.
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    mcp: "src/mcp.ts",
    "mcp-bin": "src/mcp-bin.ts",
    worker: "src/worker.ts",
    sdk: "src/sdk.ts",
    testing: "src/testing.ts",
    ui: "ui/embed.tsx",
  },
  external: ["react", "react-dom", "agentic-design"],
  format: ["esm"],
  dts: true,
  clean: true,
});
