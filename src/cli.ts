#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PACKAGE_NAME } from "./index.js";
import { VERSION } from "./version.js";

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

function defaultIo(): CliIo {
  return { out: (line) => console.log(line), err: (line) => console.error(line) };
}

function helpText(): string {
  return [
    `${PACKAGE_NAME} ${VERSION}`,
    "Notifications for humans and agents.",
    "",
    `Usage: ${PACKAGE_NAME} <command>`,
    "",
    "Commands:",
    "  mcp              Start the MCP server on stdio.",
    "",
    "Flags:",
    "  --help, -h       Print this help.",
    "  --version, -V    Print the version.",
  ].join("\n");
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "-h") {
    io.out(helpText());
    return 0;
  }
  if (first === "--version" || first === "-V") {
    io.out(VERSION);
    return 0;
  }
  if (first === "mcp") {
    const { startMcp } = await import("./mcp.js");
    await startMcp();
    return 0;
  }
  io.err(`unknown command "${first}"`);
  io.err(`Run "${PACKAGE_NAME} --help" for usage.`);
  return 2;
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (typeof invoked !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      // Exit nonzero at once. On zero, fall off the end so a running
      // server (mcp) keeps its stdio handles open.
      if (code !== 0) process.exit(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
