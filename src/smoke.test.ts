import { describe, expect, test } from "vitest";
import { runCli } from "./cli.js";
import { createMcpServer } from "./mcp.js";
import worker from "./worker.js";
import { VERSION } from "./version.js";

describe("faces", () => {
  test("cli prints the version and rejects unknown commands", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    expect(await runCli(["--version"], io)).toBe(0);
    expect(out).toEqual([VERSION]);
    expect(await runCli(["nope"], io)).toBe(2);
    expect(err[0]).toContain("unknown command");
  });

  test("worker serves /health and 404s the rest", async () => {
    const ok = await worker.fetch(new Request("http://x/health"), {});
    expect(await ok.json()).toEqual({ ok: true, name: "agentic-notify", version: VERSION });
    const miss = await worker.fetch(new Request("http://x/nope"), {});
    expect(miss.status).toBe(404);
  });

  test("mcp server builds", () => {
    expect(createMcpServer()).toBeDefined();
  });
});
