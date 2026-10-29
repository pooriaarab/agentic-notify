import { describe, expect, test } from "vitest";
import { createNotifier, NotFoundError } from "./service.js";
import { MemoryStore } from "./store.js";
import type { Recipient, SendInput } from "./types.js";

const alice: Recipient = { kind: "human", id: "alice" };
const bot: Recipient = { kind: "agent", id: "alice" }; // same id, other kind

function setup() {
  let t = 1000;
  let n = 0;
  const notifier = createNotifier({ store: new MemoryStore(), now: () => ++t, newId: () => `n${++n}` });
  return notifier;
}

function input(over: Partial<SendInput> = {}): SendInput {
  return {
    recipient: alice,
    type: "comment",
    resource: { kind: "doc", id: "d1" },
    actor: { kind: "agent", id: "helper" },
    body: "hello",
    ...over,
  };
}

describe("send and list", () => {
  test("stores to the inbox by default and lists newest first", async () => {
    const n = setup();
    await n.send(input({ body: "one" }));
    await n.send(input({ body: "two" }));
    const { items } = await n.list(alice);
    expect(items.map((i) => i.body)).toEqual(["two", "one"]);
    expect(items[0]?.readAt).toBeNull();
    expect(items[0]?.actor.kind).toBe("agent");
  });

  test("human and agent recipients with the same id do not mix", async () => {
    const n = setup();
    await n.send(input());
    expect((await n.list(bot)).items).toEqual([]);
  });

  test("rejects bad input", async () => {
    const n = setup();
    await expect(n.send(input({ type: "Bad Type" }))).rejects.toThrow();
    await expect(n.send({ ...input(), recipient: { id: "x" } } as unknown as SendInput)).rejects.toThrow();
    await expect(n.send({ ...input(), extra: 1 } as unknown as SendInput)).rejects.toThrow();
  });

  test("pages with a cursor", async () => {
    const n = setup();
    for (let i = 0; i < 5; i++) await n.send(input({ body: `m${i}` }));
    const p1 = await n.list(alice, { limit: 2 });
    const p2 = await n.list(alice, { limit: 2, cursor: p1.nextCursor ?? undefined });
    const p3 = await n.list(alice, { limit: 2, cursor: p2.nextCursor ?? undefined });
    expect([...p1.items, ...p2.items, ...p3.items].map((i) => i.body)).toEqual(["m4", "m3", "m2", "m1", "m0"]);
    expect(p3.nextCursor).toBeNull();
  });
});

describe("read state", () => {
  test("markRead is idempotent and keeps the first time", async () => {
    const n = setup();
    const { notification } = await n.send(input());
    const first = await n.markRead(alice, notification!.id);
    const again = await n.markRead(alice, notification!.id);
    expect(first.readAt).not.toBeNull();
    expect(again.readAt).toBe(first.readAt);
    expect(await n.unreadCount(alice)).toBe(0);
  });

  test("another recipient cannot read or mark it", async () => {
    const n = setup();
    const { notification } = await n.send(input());
    await expect(n.markRead(bot, notification!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(n.get(bot, notification!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(n.get(alice, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("markAllRead counts only the unread and spans pages", async () => {
    const n = setup();
    for (let i = 0; i < 120; i++) await n.send(input());
    const { items } = await n.list(alice, { limit: 1 });
    await n.markRead(alice, items[0]!.id);
    expect(await n.markAllRead(alice)).toBe(119);
    expect(await n.unreadCount(alice)).toBe(0);
  });
});

describe("preferences", () => {
  test("defaults, per-type channels and inbox off", async () => {
    const n = setup();
    expect((await n.getPreferences(alice)).muted).toBe(false);
    await n.setPreferences(alice, { channels: { mention: ["webhook", "email"], comment: ["inbox", "email"] }, muted: false, mutedTypes: [] });
    const mention = await n.send(input({ type: "mention" }));
    expect(mention.notification).toBeNull();
    expect(mention.channels).toEqual(["webhook", "email"]);
    const comment = await n.send(input({ type: "comment" }));
    expect(comment.notification).not.toBeNull();
    expect(comment.channels).toEqual(["inbox", "email"]);
  });

  test("mute drops everything, per type or global", async () => {
    const n = setup();
    await n.setPreferences(alice, { channels: {}, muted: false, mutedTypes: ["comment"] });
    expect(await n.send(input({ type: "comment" }))).toEqual({ notification: null, channels: [], muted: true });
    expect((await n.send(input({ type: "share" }))).notification).not.toBeNull();
    await n.setPreferences(alice, { channels: {}, muted: true, mutedTypes: [] });
    expect((await n.send(input({ type: "share" }))).muted).toBe(true);
    expect((await n.list(alice)).items).toHaveLength(1);
  });

  test("rejects a bad preferences object and keeps the old one", async () => {
    const n = setup();
    await n.setPreferences(alice, { channels: {}, muted: true, mutedTypes: [] });
    await expect(n.setPreferences(alice, { channels: { x: ["sms"] }, muted: false, mutedTypes: [] } as never)).rejects.toThrow();
    expect((await n.getPreferences(alice)).muted).toBe(true);
  });
});

describe("digest", () => {
  test("groups unread by type, newest group first, honors since", async () => {
    const n = setup();
    await n.send(input({ type: "share", body: "s1" })); // t=1001+
    await n.send(input({ type: "comment", body: "c1" }));
    await n.send(input({ type: "comment", body: "c2" }));
    const d = await n.digest(alice);
    expect(d.total).toBe(3);
    expect(d.groups.map((g) => [g.type, g.count, g.latest.body])).toEqual([["comment", 2, "c2"], ["share", 1, "s1"]]);
    const since = (await n.list(alice)).items[1]!.createdAt;
    expect((await n.digest(alice, since)).total).toBe(2);
    await n.markAllRead(alice);
    expect((await n.digest(alice)).total).toBe(0);
  });
});
