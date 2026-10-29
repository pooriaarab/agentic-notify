#!/usr/bin/env node
import { VERSION } from "./version.js";

const HELP = `agentic-notify-mcp ${VERSION}
Usage: agentic-notify-mcp [--help | -h | --version | -V]

Runs the MCP server on stdio. An MCP client starts it.
`;

// The `mcp` word may come first, as the package CLI takes it: `agentic-notify-mcp mcp --help`.
const [first, second] = process.argv.slice(2);
const flag = first === "mcp" ? second : first;
if (flag === "--version" || flag === "-V") {
  process.stdout.write(`${VERSION}\n`);
} else if (flag === "--help" || flag === "-h") {
  process.stdout.write(HELP);
} else {
  // Loaded only when serving, so --help and --version never pay for the server's imports.
  Promise.all([import("./mcp.js"), import("./sdk.js")])
    .then(([{ startMcp }, { createClient }]) => {
      const { NOTIFY_URL, NOTIFY_TOKEN } = process.env;
      const client = NOTIFY_URL && NOTIFY_TOKEN ? createClient({ baseUrl: NOTIFY_URL, token: NOTIFY_TOKEN }) : undefined;
      return startMcp(client);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
