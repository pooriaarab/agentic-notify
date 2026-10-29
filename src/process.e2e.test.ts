import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// Real processes: `wrangler dev` serves the Worker over a local D1 database, and the built CLI
// talks to it over HTTP. No in-process shortcuts.

const ROOT = process.cwd();
const CLI = join(ROOT, "dist", "cli.js");
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");
const ANA = "a".repeat(40);
const BOT = "b".repeat(40);
const TOKENS = JSON.stringify({
  [ANA]: { kind: "human", id: "ana" },
  [BOT]: { kind: "agent", id: "helper", canSend: true },
});

let dev: ChildProcess;
let state: string;
let url: string;
let log = "";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}

const cli = (token: string, ...args: string[]) => run("node", [CLI, ...args], { NOTIFY_URL: url, NOTIFY_TOKEN: token });

/** Start `wrangler dev` on a free port. Returns the exit reason when it dies before it answers. */
async function startDev(): Promise<string | null> {
  const port = await freePort();
  url = `http://127.0.0.1:${port}/`;
  log = "";
  // Own process group, so one signal reaches wrangler and the workerd it starts. Only PIDs this test started.
  dev = spawn(
    WRANGLER,
    [
      "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", state,
      "--var", `NOTIFY_TOKENS:${TOKENS}`, "--var", "NOTIFY_REGION:unknown",
    ],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  dev.stdout?.on("data", (d: Buffer) => (log += d));
  dev.stderr?.on("data", (d: Buffer) => (log += d));
  let exited = false;
  dev.once("exit", () => (exited = true));
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (exited) return log;
    if (Date.now() > deadline) throw new Error(`wrangler dev did not start:\n${log}`);
    try {
      if ((await fetch(`${url}health`)).ok) return null;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function stopDev(signal: NodeJS.Signals): void {
  if (dev?.pid !== undefined) {
    try {
      process.kill(-dev.pid, signal);
    } catch {
      // already gone
    }
  }
}

// Wrangler 4 needs Node 22. The other suites still run on older Node.
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

describe.skipIf(NODE_MAJOR < 22)("real processes", () => {
  beforeAll(async () => {
    // Always build, so the test never runs a stale CLI.
    const built = await run("npx", ["tsup"]);
    if (built.code !== 0) throw new Error(`build failed: ${built.err}`);
    state = mkdtempSync(join(tmpdir(), "notify-e2e-"));
    let failed = await startDev();
    // The port can be taken between the probe and the bind. Try once more on a new port.
    if (failed !== null && /address already in use|EADDRINUSE/i.test(failed)) failed = await startDev();
    if (failed !== null) throw new Error(`wrangler dev exited early:\n${failed}`);
  }, 180_000);

  afterAll(async () => {
    if (dev && dev.exitCode === null) {
      const closed = new Promise((r) => dev.once("exit", r));
      stopDev("SIGTERM");
      await Promise.race([closed, new Promise((r) => setTimeout(r, 10_000))]);
      stopDev("SIGKILL");
    }
    if (state) rmSync(state, { recursive: true, force: true });
  });

  test("the real CLI sends, lists and erases through wrangler dev", async () => {
    const sent = await cli(BOT, "send", "--to", "human:ana", "--type", "mention", "--resource", "doc:d1", "--body", "look at this");
    expect(sent.err).toBe("");
    expect(sent.code).toBe(0);
    const id = (JSON.parse(sent.out) as { notification: { id: string } }).notification.id;

    const listed = await cli(ANA, "list");
    expect(listed.code).toBe(0);
    const items = (JSON.parse(listed.out) as { items: { id: string; body: string; actor: { id: string } }[] }).items;
    expect(items.map((i) => [i.id, i.body, i.actor.id])).toEqual([[id, "look at this", "helper"]]);

    const erased = await cli(ANA, "erase", "--yes");
    expect(erased.code).toBe(0);
    expect(JSON.parse(erased.out)).toEqual({ notifications: 1 });

    const after = await cli(ANA, "list");
    expect(after.code).toBe(0);
    expect((JSON.parse(after.out) as { items: unknown[] }).items).toEqual([]);
    const gone = await cli(ANA, "get", id);
    expect(gone.code).toBe(1);
    expect(gone.err).toContain("404");
  }, 60_000);

  test("a failed call is a failed exit code, not success", async () => {
    const bad = await cli("x".repeat(40), "list");
    expect(bad.code).toBe(1);
    expect(bad.out).toBe("");
    expect(bad.err).toContain("401");
    const noSendRight = await cli(ANA, "send", "--to", "human:ana", "--type", "mention", "--resource", "doc:d1", "--body", "x");
    expect(noSendRight.code).toBe(1);
    expect(noSendRight.err).toContain("403");
  }, 60_000);
});
