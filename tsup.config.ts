import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/mcp.ts",
    "src/mcp-bin.ts",
    "src/worker.ts",
    "src/sdk.ts",
    "src/testing.ts",
    "src/account.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
});
