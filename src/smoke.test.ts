import { describe, expect, test } from "vitest";
import { runCli } from "./cli.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
    const head = await worker.fetch(new Request("http://x/health", { method: "HEAD" }), {});
    expect(head.status).toBe(200);
    const miss = await worker.fetch(new Request("http://x/nope"), {});
    expect(miss.status).toBe(404);
  });

  test("mcp ping answers over a transport", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer().connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const res = (await client.callTool({ name: "ping", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0]!.text)).toEqual({ ok: true, version: VERSION });
  });
});
