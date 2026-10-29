import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createNotifier } from "../core/service.js";
import { storeContract } from "../testing.js";
import { D1Store, migrateD1, type D1Like } from "./d1.js";

let mf: Miniflare;
let db: D1Like;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-01-01",
    d1Databases: { DB: "notify-test" },
  });
  db = (await mf.getD1Database("DB")) as unknown as D1Like;
  await migrateD1(db);
});

afterAll(async () => {
  await mf.dispose();
});

// One empty table per test; the peer is a second adapter over the same database.
storeContract(
  "d1 (miniflare)",
  async () => {
    await db.prepare("DELETE FROM notify_docs").bind().run();
    return new D1Store(db);
  },
  async () => new D1Store(db),
);

describe("d1 batch delete", () => {
  test("deleteMany sends bounded batches, not one query per row", async () => {
    await db.prepare("DELETE FROM notify_docs").bind().run();
    const calls: number[] = [];
    const counting: D1Like = {
      prepare: (sql) => db.prepare(sql),
      batch: (stmts) => {
        calls.push(stmts.length);
        return db.batch(stmts);
      },
    };
    const store = new D1Store(counting);
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const ins = db.prepare("INSERT INTO notify_docs (collection, id, doc) VALUES (?, ?, ?)");
    await db.batch(ids.map((id) => ins.bind("c", id, '{"v":1}')));
    await store.deleteMany("c", ids);
    expect(calls).toEqual([100, 100, 50]);
    expect((await store.query("c")).items).toEqual([]);
  });

  test("a failing batch rejects instead of reporting success", async () => {
    const store = new D1Store({ ...db, prepare: (sql) => db.prepare(sql), batch: async () => { throw new Error("d1 down"); } });
    await expect(store.deleteMany("c", ["a"])).rejects.toThrow(/d1 down/);
  });
});

describe("notifier on d1", () => {
  test("send, list, mark read, export and erase work on the real adapter", async () => {
    await db.prepare("DELETE FROM notify_docs").bind().run();
    const notifier = createNotifier({ store: new D1Store(db) });
    const ana = { kind: "human", id: "ana" } as const;
    const sent = await notifier.send({
      recipient: ana,
      type: "mention",
      resource: { kind: "doc", id: "d1" },
      actor: { kind: "agent", id: "helper" },
      body: "hi",
    });
    expect((await notifier.list(ana, { unreadOnly: true })).items).toHaveLength(1);
    await notifier.markRead(ana, sent.notification!.id);
    expect((await notifier.list(ana, { unreadOnly: true })).items).toHaveLength(0);
    expect((await notifier.exportData(ana)).notifications).toHaveLength(1);
    expect(await notifier.erase(ana)).toEqual({ notifications: 1 });
    expect((await notifier.list(ana)).items).toEqual([]);
  });

  test("erase works on d1 when one doc has a bad createdAt", async () => {
    await db.prepare("DELETE FROM notify_docs").bind().run();
    const store = new D1Store(db);
    const notifier = createNotifier({ store });
    const ana = { kind: "human", id: "ana" } as const;
    for (let i = 0; i < 205; i++) {
      await store.put("notifications", `n${i}`, { id: `n${i}`, recipientKey: "human:ana", createdAt: i });
    }
    await store.put("notifications", "bad", { id: "bad", recipientKey: "human:ana", createdAt: "x" });
    expect((await notifier.erase(ana)).notifications).toBe(206);
    expect((await store.query("notifications", { where: { recipientKey: "human:ana" } })).items).toEqual([]);
  }, 60_000);
});
