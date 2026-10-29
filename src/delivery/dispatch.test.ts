import { describe, expect, test } from "vitest";
import { createNotifier } from "../core/service.js";
import { MemoryStore } from "../core/store.js";
import type { Recipient, SendInput } from "../core/types.js";
import { createDispatcher } from "./dispatch.js";
import { createEmailChannel, TestEmailAdapter } from "./email.js";
import type { DeliveryChannel } from "./types.js";

const ana: Recipient = { kind: "human", id: "ana" };
const input = (over: Partial<SendInput> = {}): SendInput => ({
  recipient: ana,
  type: "mention",
  resource: { kind: "doc", id: "d1" },
  actor: { kind: "agent", id: "helper" },
  body: "secret body text",
  ...over,
});

function setup(webhook: DeliveryChannel) {
  const notifier = createNotifier({ store: new MemoryStore() });
  const email = new TestEmailAdapter();
  const logs: string[] = [];
  const dispatcher = createDispatcher({
    notifier,
    channels: {
      webhook,
      email: createEmailChannel({ port: email, resolveAddress: () => "ana@example.org" }),
    },
    logger: { warn: (m, f) => logs.push(`${m} ${JSON.stringify(f)}`) },
  });
  return { notifier, email, dispatcher, logs };
}

describe("dispatcher", () => {
  test("serves each channel the recipient chose", async () => {
    const hooks: string[] = [];
    const { notifier, email, dispatcher } = setup({ deliver: async (n) => (hooks.push(n.id), "sent") });
    await notifier.setPreferences(ana, { channels: { mention: ["inbox", "webhook", "email"] }, muted: false, mutedTypes: [] });
    const r = await dispatcher.notify(input());
    expect(r.deliveries).toEqual([{ channel: "webhook", ok: true }, { channel: "email", ok: true }]);
    expect(hooks).toEqual([r.notification!.id]);
    expect(email.sent).toEqual([{ to: "ana@example.org", subject: "mention: doc d1", text: "secret body text" }]);
    expect((await notifier.list(ana)).items).toHaveLength(1);
  });

  test("a failing channel does not block the others and the log holds no content", async () => {
    const { notifier, email, dispatcher, logs } = setup({
      deliver: async () => {
        throw new Error("boom ana@example.org secret body text");
      },
    });
    await notifier.setPreferences(ana, { channels: { mention: ["webhook", "email"] }, muted: false, mutedTypes: [] });
    const r = await dispatcher.notify(input());
    expect(r.deliveries).toEqual([{ channel: "webhook", ok: false, error: "Error" }, { channel: "email", ok: true }]);
    expect(email.sent).toHaveLength(1);
    expect(r.stored).toBe(false);
    expect(logs.join("\n")).not.toMatch(/ana@example|secret body/);
    expect(logs).toHaveLength(1);
  });

  test("a missing target or channel is reported as skipped, not as sent", async () => {
    const notifier = createNotifier({ store: new MemoryStore() });
    const none = createDispatcher({
      notifier,
      channels: { email: createEmailChannel({ port: new TestEmailAdapter(), resolveAddress: () => null }) },
    });
    await notifier.setPreferences(ana, { channels: { mention: ["inbox", "email", "webhook"] }, muted: false, mutedTypes: [] });
    expect((await none.notify(input())).deliveries).toEqual([
      { channel: "email", ok: false, skipped: "no_target" },
      { channel: "webhook", ok: false, skipped: "no_channel" },
    ]);
  });

  test("an address with control characters is refused", async () => {
    const email = new TestEmailAdapter();
    const ch = createEmailChannel({ port: email, resolveAddress: () => "a@b.c\r\nBcc: x@y.z" });
    await expect(ch.deliver({ id: "x", recipient: ana, type: "share", resource: { kind: "doc", id: "1" }, actor: ana, body: "b", createdAt: 1, readAt: null })).rejects.toThrow();
    expect(email.sent).toEqual([]);
  });

  test("muted sends nothing anywhere", async () => {
    const hooks: string[] = [];
    const { notifier, email, dispatcher } = setup({ deliver: async (n) => (hooks.push(n.id), "sent") });
    await notifier.setPreferences(ana, { channels: { mention: ["webhook", "email"] }, muted: true, mutedTypes: [] });
    const r = await dispatcher.notify(input());
    expect(r).toMatchObject({ muted: true, notification: null, deliveries: [] });
    expect(hooks).toEqual([]);
    expect(email.sent).toEqual([]);
  });

  test("email subject cannot carry header injection", async () => {
    const email = new TestEmailAdapter();
    const ch = createEmailChannel({ port: email, resolveAddress: () => "a@b.c" });
    await ch.deliver({
      id: "x", recipient: ana, type: "share", resource: { kind: "doc\r\nBcc: x@y.z", id: "1" },
      actor: ana, body: "b", createdAt: 1, readAt: null,
    });
    expect(email.sent[0]!.subject).not.toMatch(/[\r\n]/);
  });
});
