#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ApiError, createClient } from "./sdk.js";
import { PACKAGE_NAME } from "./index.js";
import { VERSION } from "./version.js";

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

function defaultIo(): CliIo {
  return { out: (l) => console.log(l), err: (l) => console.error(l), env: process.env };
}

class UsageError extends Error {}

function helpText(): string {
  return [
    `${PACKAGE_NAME} ${VERSION}`,
    "Notifications for humans and agents.",
    "",
    `Usage: ${PACKAGE_NAME} <command> [flags]`,
    "",
    "Commands:",
    "  list [--unread] [--limit <n>] [--cursor <c>]   List your notifications.",
    "  get <id>                                       Show one notification.",
    "  read <id>                                      Mark one as read.",
    "  read-all                                       Mark all as read.",
    "  unread-count                                   Count unread.",
    "  digest [--since <ms>]                          Group unread by type.",
    "  prefs get                                      Show your preferences.",
    "  prefs set --json <json>                        Replace your preferences.",
    "  send --to <kind:id> --type <t> --resource <kind:id> --body <text>",
    "                                                 Send a notification.",
    "  export                                         Print all data held about you.",
    "  erase --yes                                    Delete all data held about you.",
    "  mcp                                            Start the MCP server on stdio.",
    "",
    "Environment: NOTIFY_URL (server base url), NOTIFY_TOKEN (bearer token).",
    "Flags: --help, -h; --version, -V. mcp also takes -v for --version.",
  ].join("\n");
}

function flags(args: string[], known: { value: string[]; bool: string[] }) {
  const out: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      rest.push(a);
    } else if (known.bool.includes(a.slice(2))) {
      out[a.slice(2)] = true;
    } else if (known.value.includes(a.slice(2)) && i + 1 < args.length) {
      out[a.slice(2)] = args[++i]!;
    } else {
      throw new UsageError(`unknown or incomplete flag "${a}"`);
    }
  }
  return { flags: out, rest };
}

function pair(text: unknown, what: string): { kind: string; id: string } {
  const m = typeof text === "string" ? /^([^:]+):(.+)$/.exec(text) : null;
  if (!m) throw new UsageError(`${what} must look like kind:id`);
  return { kind: m[1]!, id: m[2]! };
}

function int(text: string | true | undefined, what: string): number | undefined {
  if (text === undefined) return undefined;
  const n = typeof text === "string" && /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(n)) throw new UsageError(`${what} needs a whole number`);
  return n;
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    io.out(helpText());
    return 0;
  }
  if (cmd === "--version" || cmd === "-V") {
    io.out(VERSION);
    return 0;
  }
  // `mcp --help` and `mcp --version` answer and exit. They never start the server.
  if (cmd === "mcp" && args.some((a) => a === "--help" || a === "-h")) {
    io.out(helpText());
    return 0;
  }
  if (cmd === "mcp" && args.some((a) => a === "--version" || a === "-V" || a === "-v")) {
    io.out(VERSION);
    return 0;
  }
  try {
    if (cmd === "mcp") {
      const { startMcp } = await import("./mcp.js");
      // Without a server url and token the MCP server still starts, with ping only.
      await startMcp(io.env.NOTIFY_URL && io.env.NOTIFY_TOKEN ? client() : undefined);
      return 0;
    }
    return await run();
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      io.err(`Run "${PACKAGE_NAME} --help" for usage.`);
      return 2;
    }
    if (error instanceof ApiError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  function client() {
    const baseUrl = io.env.NOTIFY_URL;
    const token = io.env.NOTIFY_TOKEN;
    if (!baseUrl || !token) throw new UsageError("set NOTIFY_URL and NOTIFY_TOKEN");
    return createClient({ baseUrl, token, fetch: io.fetch });
  }

  async function run(): Promise<number> {
    const print = (v: unknown) => io.out(JSON.stringify(v));
    const one = (rest: string[]) => {
      if (rest.length !== 1) throw new UsageError(`${cmd} needs one id`);
      return rest[0]!;
    };
    const none = (a: string[]) => {
      if (a.length > 0) throw new UsageError(`${cmd} takes no arguments`);
    };
    switch (cmd) {
      case "list": {
        const f = flags(args, { value: ["limit", "cursor"], bool: ["unread"] });
        none(f.rest);
        const c = client();
        print(await c.list({
          unreadOnly: f.flags.unread === true,
          limit: int(f.flags.limit, "--limit"),
          cursor: typeof f.flags.cursor === "string" ? f.flags.cursor : undefined,
        }));
        return 0;
      }
      case "get":
        print(await client().get(one(args)));
        return 0;
      case "read":
        print(await client().markRead(one(args)));
        return 0;
      case "read-all":
        none(args);
        print(await client().markAllRead());
        return 0;
      case "unread-count":
        none(args);
        print(await client().unreadCount());
        return 0;
      case "digest": {
        const f = flags(args, { value: ["since"], bool: [] });
        none(f.rest);
        print(await client().digest(int(f.flags.since, "--since")));
        return 0;
      }
      case "prefs": {
        const [sub, ...rest] = args;
        if (sub === "get") {
          none(rest);
          print(await client().getPreferences());
          return 0;
        }
        if (sub === "set") {
          const f = flags(rest, { value: ["json"], bool: [] });
          none(f.rest);
          if (typeof f.flags.json !== "string") throw new UsageError("prefs set needs --json");
          let parsed: unknown;
          try {
            parsed = JSON.parse(f.flags.json);
          } catch {
            throw new UsageError("--json is not valid JSON");
          }
          print(await client().setPreferences(parsed as never));
          return 0;
        }
        throw new UsageError("prefs needs get or set");
      }
      case "send": {
        const f = flags(args, { value: ["to", "type", "resource", "body", "url"], bool: [] });
        none(f.rest);
        if (typeof f.flags.type !== "string" || typeof f.flags.body !== "string") throw new UsageError("send needs --type and --body");
        const to = pair(f.flags.to, "--to");
        const res = pair(f.flags.resource, "--resource");
        print(await client().send({
          recipient: { kind: to.kind as "human" | "agent", id: to.id },
          type: f.flags.type,
          resource: { kind: res.kind, id: res.id, ...(typeof f.flags.url === "string" ? { url: f.flags.url } : {}) },
          body: f.flags.body,
        }));
        return 0;
      }
      case "export":
        none(args);
        print(await client().exportData());
        return 0;
      case "erase": {
        const f = flags(args, { value: [], bool: ["yes"] });
        none(f.rest);
        if (f.flags.yes !== true) throw new UsageError("erase deletes all your data. Pass --yes to confirm");
        print(await client().erase());
        return 0;
      }
      default:
        throw new UsageError(`unknown command "${cmd}"`);
    }
  }
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
