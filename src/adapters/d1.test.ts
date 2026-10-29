import { createD1Store, D1_SCHEMA, type D1Like } from "agentic-identity/cloudflare";
import { runStoreContract } from "agentic-identity/testing";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createNotifier } from "../core/service.js";

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
  await db.prepare(D1_SCHEMA).run();
});

afterAll(async () => {
  await mf.dispose();
});

// Miniflare does not report a serving region, so the tests use "unknown". The port contract comes from agentic-identity. Each store gets an empty table.
runStoreContract(async (options) => {
  await db.prepare("DELETE FROM store_docs").run();
  return createD1Store(db, { region: "unknown", ...options });
});

test("the notifier sends, lists and erases through a D1 store", async () => {
  await db.prepare("DELETE FROM store_docs").run();
  const notifier = createNotifier({ store: createD1Store(db, { region: "unknown" }) });
  const ana = { kind: "human", id: "ana" } as const;
  await notifier.send({
    recipient: ana,
    type: "comment",
    resource: { kind: "doc", id: "1" },
    actor: { kind: "human", id: "bob" },
    body: "hi",
  });
  expect((await notifier.list(ana)).items).toHaveLength(1);
  expect(await notifier.erase(ana)).toEqual({ notifications: 1 });
  expect((await notifier.list(ana)).items).toEqual([]);
});
