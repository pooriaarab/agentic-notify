#!/usr/bin/env node
import { VERSION } from "./version.js";

const HELP = `agentic-notify-mcp ${VERSION}
Usage: agentic-notify-mcp [mcp] [--help | -h | --version | -V]

Runs the MCP server on stdio. An MCP client starts it.
After mcp, -v also prints the version.
`;

// The `mcp` word may come first, as the package CLI takes it: `agentic-notify-mcp mcp --help`.
const argv = process.argv.slice(2);
const mcpWord = argv[0] === "mcp";
const args = mcpWord ? argv.slice(1) : argv;
const has = (...names: string[]) => args.some((a) => names.includes(a));

// The package CLI also takes -v for --version after the mcp word, so the bin does too.
if (has("--help", "-h")) {
  process.stdout.write(HELP);
} else if (has("--version", "-V") || (mcpWord && has("-v"))) {
  process.stdout.write(`${VERSION}\n`);
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
