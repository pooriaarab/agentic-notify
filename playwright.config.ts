// Drives the demo page in a real browser against `wrangler dev`. Run `npm run test:ui`.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { ANA, BOT } from "./e2e-ui/keys.js";
import { seedSql, type SeedCaller } from "./src/test-seed.js";

// Wrangler 4 needs Node 22. On older Node the browser tests are skipped, like the process tests.
const NODE_OK = Number(process.versions.node.split(".")[0]) >= 22;
export const PORT = 8891;
const CALLERS: SeedCaller[] = [
  { token: ANA, id: "ana", kind: "human", scopes: ["notify:read", "notify:write", "notify-send:write"] },
  { token: BOT, id: "build-bot", kind: "agent", scopes: ["notify-send:write"] },
];
const PERSIST = NODE_OK ? mkdtempSync(join(tmpdir(), "notify-ui-d1-")) : "";
if (NODE_OK) process.on("exit", () => rmSync(PERSIST, { recursive: true, force: true }));
// The keys are credentials kept in the store: write them first, then start the Worker on the same data.
const SEED_FILE = join(PERSIST, "seed.sql");
if (NODE_OK) writeFileSync(SEED_FILE, seedSql(CALLERS).join(";\n") + ";\n");
const SEED = `node_modules/.bin/wrangler d1 execute DB --local -c wrangler.demo.jsonc --persist-to ${PERSIST} --file ${SEED_FILE}`;

export default defineConfig({
  testDir: "e2e-ui",
  testMatch: NODE_OK ? "*.ui.spec.ts" : "none",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1280, height: 800 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: !NODE_OK ? undefined : {
    command: `${SEED} && node_modules/.bin/wrangler dev --local -c wrangler.demo.jsonc --ip 127.0.0.1 --port ${PORT} --inspector-port 9341 --persist-to ${PERSIST} --var NOTIFY_REGION:unknown`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { WRANGLER_SEND_METRICS: "false", CI: "1" },
  },
});
