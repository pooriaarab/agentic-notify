import { describe, expect, test } from "vitest";
import { createNotifier } from "./service.js";
import { createMemoryStore, type Store } from "agentic-identity";
import type { Recipient, SendInput } from "./types.js";

/** A store whose deletes report success and do nothing. */
function deleteIsNoop(store: Store): Store {
  return { ...store, transaction: (fn) => store.transaction((tx) => fn({ ...tx, delete: async () => {} })) };
}

const ana: Recipient = { kind: "human", id: "ana" };
const bob: Recipient = { kind: "human", id: "bob" };
const input = (recipient: Recipient, body = "hi"): SendInput => ({
  recipient,
  type: "comment",
  resource: { kind: "doc", id: "d1" },
  actor: { kind: "agent", id: "helper" },
  body,
});

function setup(retentionMs?: number) {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => (t += ms) };
  const notifier = createNotifier({ store: createMemoryStore(), now: () => t, retentionMs });
  return { notifier, clock };
}

describe("export and erase", () => {
  test("export holds only that recipient's data, with preferences", async () => {
    const { notifier } = setup();
    await notifier.setPreferences(ana, { channels: {}, muted: true, mutedTypes: [] });
    await notifier.send(input(bob, "for bob")); // bob has default prefs
    await notifier.setPreferences(ana, { channels: {}, muted: false, mutedTypes: [] });
    await notifier.send(input(ana, "for ana"));
    const out = await notifier.exportData(ana);
    expect(out.recipient).toEqual(ana);
    expect(out.notifications.map((n) => n.body)).toEqual(["for ana"]);
    expect(out.preferences?.muted).toBe(false);
    expect((await notifier.exportData({ kind: "human", id: "nobody" })).preferences).toBeNull();
  });

  test("erase removes one recipient across pages and leaves the others", async () => {
    const { notifier } = setup();
    await notifier.setPreferences(ana, { channels: {}, muted: false, mutedTypes: ["share"] });
    for (let i = 0; i < 230; i++) await notifier.send(input(ana));
    await notifier.send(input(bob));
    expect(await notifier.erase(ana)).toEqual({ notifications: 230 });
    expect(await notifier.exportData(ana)).toEqual({ recipient: ana, preferences: null, notifications: [] });
    expect((await notifier.list(bob)).items).toHaveLength(1);
    expect(await notifier.erase(ana)).toEqual({ notifications: 0 });
  });

  test("erase still works when a doc has a bad createdAt, and fails loudly on a store whose delete does nothing", async () => {
    const store = createMemoryStore();
    await store.put("notifications", "bad", { id: "bad", recipientKey: "human:ana", createdAt: "x" });
    expect((await createNotifier({ store }).erase(ana)).notifications).toBe(1);
    await store.put("notifications", "stuck", { id: "stuck", recipientKey: "human:ana", createdAt: 1 });
    await expect(createNotifier({ store: deleteIsNoop(store) }).erase(ana)).rejects.toThrow(/did not finish/);
  });

  test("erase catches a notification that arrives during the delete", async () => {
    const store = createMemoryStore();
    const notifier = createNotifier({ store });
    await notifier.send(input(ana));
    let injected = false;
    const racing: Store = {
      ...store,
      transaction: async (fn) => {
        const out = await store.transaction(fn);
        if (!injected) {
          injected = true;
          await notifier.send(input(ana, "late"));
        }
        return out;
      },
    };
    expect((await createNotifier({ store: racing }).erase(ana)).notifications).toBe(2);
    expect((await notifier.exportData(ana)).notifications).toEqual([]);
  });
});

describe("retention", () => {
  test("a doc with a bad createdAt is left alone, not swept", async () => {
    const store = createMemoryStore();
    let t = 1000;
    const notifier = createNotifier({ store, now: () => t, retentionMs: 10 });
    await notifier.send(input(ana, "old"));
    await store.put("notifications", "bad", { id: "bad", recipientKey: "human:ana", createdAt: "x" });
    t = 5000;
    expect(await notifier.sweep()).toBe(1);
    expect(await store.get("notifications", "bad")).not.toBeNull();
  });

  test("sweep removes only notifications older than the window, for all recipients", async () => {
    const { notifier, clock } = setup(1000);
    await notifier.send(input(ana, "old"));
    await notifier.send(input(bob, "old"));
    clock.advance(600);
    await notifier.send(input(ana, "mid"));
    clock.advance(600); // old ones are now 1200 old, mid is 600
    await notifier.send(input(ana, "new"));
    expect(await notifier.sweep()).toBe(2);
    expect((await notifier.list(ana)).items.map((n) => n.body)).toEqual(["new", "mid"]);
    expect((await notifier.list(bob)).items).toEqual([]);
    expect(await notifier.sweep()).toBe(0);
  });

  test("a bad doc does not stop the sweep of more than a page of expired ones", async () => {
    const store = createMemoryStore();
    let t = 1000;
    const notifier = createNotifier({ store, now: () => t, retentionMs: 10 });
    for (let i = 0; i < 450; i++) await notifier.send(input(ana));
    await store.put("notifications", "bad", { id: "bad", recipientKey: "human:ana", createdAt: "x" });
    t = 5000;
    expect(await notifier.sweep()).toBe(450);
    expect(await store.get("notifications", "bad")).not.toBeNull();
  });

  test("a full page of bad docs makes the sweep throw, not succeed", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 200; i++) await store.put("notifications", `bad${i}`, { id: `bad${i}`, createdAt: "x" });
    const notifier = createNotifier({ store, now: () => 5000, retentionMs: 10 });
    await expect(notifier.sweep()).rejects.toThrow(/blocked/);
  });

  test("sweep fails on a store whose delete does nothing, and export fails loudly on a bad doc", async () => {
    const store = createMemoryStore();
    const notifier = createNotifier({ store, now: () => 5000, retentionMs: 10 });
    await store.put("notifications", "old", { id: "old", recipientKey: "human:ana", createdAt: 1, type: "t", recipient: ana, resource: { kind: "d", id: "1" }, actor: ana, body: "b", readAt: null });
    await store.put("notifications", "bad", { id: "bad", recipientKey: "human:ana", createdAt: "x" });
    await expect(createNotifier({ store: deleteIsNoop(store), now: () => 5000, retentionMs: 10 }).sweep()).rejects.toThrow(/did not finish/);
    await expect(notifier.exportData(ana)).rejects.toThrow();
  });

  test("sweep spans pages", async () => {
    const { notifier, clock } = setup(10);
    for (let i = 0; i < 450; i++) await notifier.send(input(ana));
    clock.advance(100);
    await notifier.send(input(ana, "keep"));
    expect(await notifier.sweep()).toBe(450);
    expect((await notifier.list(ana)).items).toHaveLength(1);
  });

  test("no retention keeps everything, and a bad retention is refused", async () => {
    const { notifier, clock } = setup();
    await notifier.send(input(ana));
    clock.advance(10 ** 12);
    expect(await notifier.sweep()).toBe(0);
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() => createNotifier({ store: createMemoryStore(), retentionMs: bad })).toThrow(RangeError);
    }
  });
});
