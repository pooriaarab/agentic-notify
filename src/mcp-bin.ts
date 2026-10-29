#!/usr/bin/env node
import { startMcp } from "./mcp.js";
import { createClient } from "./sdk.js";

const { NOTIFY_URL, NOTIFY_TOKEN } = process.env;
const client = NOTIFY_URL && NOTIFY_TOKEN ? createClient({ baseUrl: NOTIFY_URL, token: NOTIFY_TOKEN }) : undefined;

startMcp(client).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
