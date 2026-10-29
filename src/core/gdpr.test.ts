import { describe, expect, test } from "vitest";
import { createNotifier } from "./service.js";
import { MemoryStore } from "./store.js";
import type { Recipient, SendInput } from "./types.js";

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
  const notifier = createNotifier({ store: new MemoryStore(), now: () => t, retentionMs });
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
});

describe("retention", () => {
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
      expect(() => createNotifier({ store: new MemoryStore(), retentionMs: bad })).toThrow(RangeError);
    }
  });
});
