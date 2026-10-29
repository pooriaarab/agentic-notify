import { build } from "esbuild";
import { D1_SCHEMA } from "agentic-identity/cloudflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli } from "./cli.js";
import { createMcpServer } from "./mcp.js";
import { ApiError, createClient } from "./sdk.js";

const ANA = "a".repeat(40);
const BOT = "b".repeat(40);
const EVE = "e".repeat(40);
const TOKENS = {
  [ANA]: { kind: "human", id: "ana", canSend: true },
  [BOT]: { kind: "agent", id: "helper", canSend: true },
  [EVE]: { kind: "human", id: "eve" },
};

let mf: Miniflare;
let url: string;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["src/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["worker", "browser"],
    logLevel: "error",
  });
  mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0]!.text,
    compatibilityDate: "2026-01-01",
    d1Databases: { DB: "notify-e2e" },
    bindings: { NOTIFY_TOKENS: JSON.stringify(TOKENS), NOTIFY_REGION: "unknown" },
  });
  url = (await mf.ready).toString();
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

const as = (token: string) => createClient({ baseUrl: url, token });
const note = (to: string, body = "please approve") => ({
  recipient: { kind: "human" as const, id: to },
  type: "approval_request",
  resource: { kind: "doc", id: "d1" },
  body,
});

describe("worker http api", () => {
  test("health is open, the api needs a known token", async () => {
    expect((await fetch(`${url}health`)).status).toBe(200);
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer nope" }, { authorization: `Basic ${ANA}` }]) {
      expect((await fetch(`${url}api/v1/notifications`, { headers })).status).toBe(401);
    }
  });

  test("an agent sends, the person reads and marks it, and the actor is the caller", async () => {
    const sent = await as(BOT).send(note("ana", "ship it?"));
    expect(sent.stored).toBe(true);
    expect(sent.notification?.actor).toEqual({ kind: "agent", id: "helper" });
    const ana = as(ANA);
    expect((await ana.unreadCount()).count).toBe(1);
    const page = await ana.list({ unreadOnly: true });
    expect(page.items[0]).toMatchObject({ body: "ship it?", readAt: null });
    expect((await ana.markRead(page.items[0]!.id)).readAt).not.toBeNull();
    expect((await ana.unreadCount()).count).toBe(0);
    expect((await ana.digest()).total).toBe(0);
  });

  test("others cannot read it, and a caller without the send right is refused", async () => {
    const sent = await as(BOT).send(note("ana"));
    const eve = as(EVE);
    await expect(eve.get(sent.notification!.id)).rejects.toMatchObject({ status: 404 });
    await expect(eve.markRead(sent.notification!.id)).rejects.toMatchObject({ status: 404 });
    expect((await eve.list()).items).toEqual([]);
    await expect(eve.send(note("ana"))).rejects.toMatchObject({ status: 403 });
  });

  test("bad input gives 400 without echoing it", async () => {
    const res = await fetch(`${url}api/v1/notifications`, {
      method: "POST",
      headers: { authorization: `Bearer ${BOT}`, "content-type": "application/json" },
      body: JSON.stringify({ ...note("ana", "SECRET-CONTENT"), type: "Bad Type", actor: { kind: "human", id: "x" } }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("SECRET-CONTENT");
    await expect(as(ANA).list({ limit: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(as(ANA).list({ cursor: "%%%" })).rejects.toMatchObject({ status: 400 });
    const notJson = await fetch(`${url}api/v1/preferences`, { method: "PUT", headers: { authorization: `Bearer ${ANA}` }, body: "{" });
    expect(notJson.status).toBe(400);
  });

  test("a channel the default worker cannot serve is reported as skipped", async () => {
    const eve = as(EVE);
    await eve.setPreferences({ channels: { share: ["webhook"] }, muted: false, mutedTypes: [] });
    const r = await as(BOT).send({ ...note("eve"), type: "share" });
    expect(r.deliveries).toEqual([{ channel: "webhook", ok: false, skipped: "no_channel" }]);
    await eve.setPreferences({ channels: {}, muted: false, mutedTypes: [] });
  });

  test("a 200 that is not JSON is an error in the sdk", async () => {
    const html = createClient({ baseUrl: "http://x", token: ANA, fetch: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch });
    await expect(html.unreadCount()).rejects.toMatchObject({ code: "bad_response" });
  });

  test("preferences: mute drops sends", async () => {
    const eve = as(EVE);
    await eve.setPreferences({ channels: {}, muted: true, mutedTypes: [] });
    expect((await eve.getPreferences()).muted).toBe(true);
    expect(await as(BOT).send(note("eve"))).toMatchObject({ muted: true, notification: null });
    await eve.setPreferences({ channels: {}, muted: false, mutedTypes: [] });
  });

  test("export and erase work on the caller's own data only", async () => {
    await as(BOT).send(note("ana", "to be erased"));
    const zed = as(ANA);
    const exported = await zed.exportData();
    expect(exported.recipient).toEqual({ kind: "human", id: "ana" });
    expect(exported.notifications.length).toBeGreaterThan(0);
    const erased = await zed.erase();
    expect(erased.notifications).toBe(exported.notifications.length);
    expect((await zed.exportData()).notifications).toEqual([]);
    expect((await as(EVE).getPreferences()).muted).toBe(false);
  });

  test("not configured means every api call is refused", async () => {
    const bare = new Miniflare({
      modules: true,
      script: (await build({ entryPoints: ["src/worker.ts"], bundle: true, write: false, format: "esm", platform: "neutral", mainFields: ["module", "main"], conditions: ["worker", "browser"], logLevel: "error" })).outputFiles[0]!.text,
      compatibilityDate: "2026-01-01",
      d1Databases: { DB: "bare" },
    });
    try {
      const res = await bare.dispatchFetch("http://x/api/v1/notifications", { headers: { authorization: `Bearer ${ANA}` } });
      expect(res.status).toBe(503);
    } finally {
      await bare.dispose();
    }
  });
});

describe("worker region", () => {
  async function workerWith(region: string | undefined): Promise<{ mf: Miniflare; url: string }> {
    const bundle = await build({
      entryPoints: ["src/worker.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
      conditions: ["worker", "browser"],
      logLevel: "error",
    });
    const bindings: Record<string, string> = { NOTIFY_TOKENS: JSON.stringify(TOKENS) };
    if (region !== undefined) bindings.NOTIFY_REGION = region;
    const m = new Miniflare({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: "2026-01-01",
      d1Databases: { DB: "notify-region" + Math.random().toString(36).slice(2) },
      bindings,
    });
    return { mf: m, url: (await m.ready).toString() };
  }

  test("a 0.1.0 table that still holds rows refuses every call until the rows are copied", async () => {
    const w = await workerWith("unknown");
    try {
      const db = await w.mf.getD1Database("DB");
      await db.exec("CREATE TABLE notify_docs (collection TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (collection, id))");
      const old = JSON.stringify({
        id: "n1", type: "mention", recipient: { kind: "human", id: "ana" }, resource: { kind: "doc", id: "d1" },
        actor: { kind: "agent", id: "helper" }, body: "old note", createdAt: 5, readAt: null, recipientKey: "human:ana",
      });
      await db.prepare("INSERT INTO notify_docs (collection, id, doc) VALUES ('notifications', 'n1', ?)").bind(old).run();
      const ask = () => fetch(`${w.url}api/v1/notifications`, { headers: { authorization: `Bearer ${ANA}` } });
      expect((await ask()).status).toBe(503);
      // The upgrade steps from the changelog.
      await db.exec(D1_SCHEMA);
      await db.exec("INSERT OR IGNORE INTO store_docs (collection, id, body, version) SELECT collection, id, doc, 1 FROM notify_docs");
      await db.exec("DROP TABLE notify_docs");
      const res = await ask();
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: { body: string }[] }).items.map((i) => i.body)).toEqual(["old note"]);
    } finally {
      await w.mf.dispose();
    }
  }, 60_000);

  // Miniflare reports no serving region, so a region of "eu" cannot be confirmed and the API refuses.
  test.each([undefined, "eu", "mars"])("region %s is refused as not configured", async (region) => {
    const w = await workerWith(region);
    try {
      const res = await fetch(`${w.url}api/v1/notifications`, { headers: { authorization: `Bearer ${ANA}` } });
      expect(res.status).toBe(503);
    } finally {
      await w.mf.dispose();
    }
  }, 60_000);
});

describe("cli over the worker", () => {
  async function cli(token: string, ...argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      out: (l) => void out.push(l),
      err: (l) => void err.push(l),
      env: { NOTIFY_URL: url, NOTIFY_TOKEN: token },
    });
    return { code, out, err };
  }

  test("send, list, get, read, count", async () => {
    const sent = await cli(BOT, "send", "--to", "human:ana", "--type", "share", "--resource", "doc:d9", "--url", "https://example.org/d/9", "--body", "shared with you");
    expect(sent.code).toBe(0);
    const id = JSON.parse(sent.out[0]!).notification.id as string;
    expect(JSON.parse((await cli(BOT, "list")).out[0]!).items).toEqual([]);
    const unread = JSON.parse((await cli(ANA, "list", "--unread", "--limit", "50")).out[0]!);
    expect(unread.items.map((n: { id: string }) => n.id)).toContain(id);
    expect(JSON.parse((await cli(ANA, "get", id)).out[0]!).resource.url).toBe("https://example.org/d/9");
    expect(JSON.parse((await cli(ANA, "read", id)).out[0]!).readAt).not.toBeNull();
    expect((await cli(ANA, "read-all")).code).toBe(0);
    expect(JSON.parse((await cli(ANA, "unread-count")).out[0]!)).toEqual({ count: 0 });
    expect(JSON.parse((await cli(ANA, "prefs", "get")).out[0]!)).toHaveProperty("muted");
    expect((await cli(ANA, "digest", "--since", "0")).code).toBe(0);
  });

  test("errors give exit codes: usage 2, api 1", async () => {
    expect((await cli(ANA, "nope")).code).toBe(2);
    expect((await cli(ANA, "erase")).code).toBe(2);
    expect((await cli(ANA, "send", "--to", "bad", "--type", "t", "--resource", "a:b", "--body", "x")).code).toBe(2);
    const denied = await cli(EVE, "send", "--to", "human:ana", "--type", "share", "--resource", "doc:1", "--body", "x");
    expect(denied.code).toBe(1);
    expect(denied.err[0]).toContain("forbidden");
    const noEnv = await runCli(["list"], { out: () => {}, err: () => {}, env: {} });
    expect(noEnv).toBe(2);
  });
});

describe("mcp over the worker", () => {
  test("lists tools and runs send, list, mark_read, preferences", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(as(ANA)).connect(a);
    const mcp = new Client({ name: "t", version: "0" });
    await mcp.connect(b);
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["list_notifications", "read_notification", "mark_read", "mark_all_read", "get_preferences", "set_preferences", "send_notification"]));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      return { isError: r.isError === true, data: JSON.parse(r.content[0]!.text) };
    };
    await as(BOT).send(note("ana", "via mcp"));
    const listed = await call("list_notifications", { unreadOnly: true });
    expect(listed.data.items[0].body).toBe("via mcp");
    expect((await call("mark_read", { id: listed.data.items[0].id })).data.readAt).not.toBeNull();
    expect((await call("get_preferences")).data.muted).toBe(false);
    expect((await call("set_preferences", { channels: {}, muted: false, mutedTypes: ["x"] })).data.mutedTypes).toEqual(["x"]);
    const missing = await call("read_notification", { id: "nope" });
    expect(missing).toMatchObject({ isError: true, data: { error: "not_found", status: 404 } });
    await as(ANA).setPreferences({ channels: {}, muted: false, mutedTypes: [] });
  });

  test("without a client the tools report not configured", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer().connect(a);
    const mcp = new Client({ name: "t", version: "0" });
    await mcp.connect(b);
    const r = (await mcp.callTool({ name: "list_notifications", arguments: {} })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    expect(ApiError).toBeDefined();
  });
});
