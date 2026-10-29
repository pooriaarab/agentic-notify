// Failure cases for the account contract, written before the code.
//  1. A subject with no id, an empty id or an unknown kind is refused. Missing deps are refused.
//  2. Export holds only the subject's inbox and preferences, as plain JSON. Another recipient's data is never in it.
//  3. Erase removes the notifications and preferences, and counts them. A second erase counts zero.
//  4. A person and an agent with the same id are two subjects. A user token acts as its person.
//  5. Notifications that name the subject only as actor stay with their recipients.
//  6. The collection names stay stable.
import { describe, expect, it } from "vitest";
import { notifyAccount as fromSubpath } from "./account.js";
import { createMemoryStore, createNotifier, notifyAccount } from "./index.js";
import type { AccountSubject as Principal } from "./index.js";

const ANA: Principal = { id: "ana", kind: "human" };
const BOB: Principal = { id: "bob", kind: "human" };

function setup() {
  const notifier = createNotifier({ store: createMemoryStore() });
  const deps = { notifier };
  const send = (kind: "human" | "agent", id: string, actor = { kind: "human" as const, id: "zed" }) =>
    notifier.send({ recipient: { kind, id }, type: "mention", resource: { kind: "doc", id: "d1" }, actor, body: `to-${id}` });
  return { notifier, deps, send };
}

describe("subject", () => {
  it("refuses a bad subject and missing deps", async () => {
    const { deps } = setup();
    for (const bad of [{ id: "", kind: "human" }, { id: "ana" }, { id: "ana", kind: "wizard" }, null]) {
      await expect(notifyAccount.exportAccount(bad as never, deps)).rejects.toThrow(/subject/);
      await expect(notifyAccount.eraseAccount(bad as never, deps)).rejects.toThrow(/subject/);
    }
    await expect(notifyAccount.exportAccount(ANA, {} as never)).rejects.toThrow("needs deps.notifier");
    await expect(notifyAccount.eraseAccount(ANA, undefined as never)).rejects.toThrow("needs deps.notifier");
  });
});

describe("exportAccount", () => {
  it("holds only the subject's data, as plain JSON, under stable names", async () => {
    const { notifier, deps, send } = setup();
    await send("human", "ana");
    await send("human", "bob");
    await notifier.setPreferences({ kind: "human", id: "ana" }, { channels: {}, muted: false, mutedTypes: ["x"] });
    const out = await notifyAccount.exportAccount(ANA, deps);
    expect(Object.keys(out)).toEqual(["notifications", "preferences"]);
    expect(out.notifications).toMatchObject([{ body: "to-ana", recipient: { kind: "human", id: "ana" } }]);
    expect(out.preferences).toMatchObject([{ mutedTypes: ["x"] }]);
    expect(JSON.stringify(out)).not.toContain("to-bob");
    expect(JSON.parse(JSON.stringify(out))).toStrictEqual(out);
  });

  it("exports an empty account as empty collections", async () => {
    const { deps } = setup();
    expect(await notifyAccount.exportAccount(BOB, deps)).toStrictEqual({ notifications: [], preferences: [] });
  });

  it("keeps a person and an agent with one id apart, and maps user tokens and agent kinds", async () => {
    const { deps, send } = setup();
    await send("human", "ana");
    await send("agent", "ana");
    const person = await notifyAccount.exportAccount(ANA, deps);
    const agent = await notifyAccount.exportAccount({ id: "ana", kind: "agent_of_human" }, deps);
    const token = await notifyAccount.exportAccount({ id: "ana", kind: "user_token" }, deps);
    expect(person.notifications).toMatchObject([{ recipient: { kind: "human" } }]);
    expect(agent.notifications).toMatchObject([{ recipient: { kind: "agent" } }]);
    expect(token).toStrictEqual(person);
  });
});

describe("eraseAccount", () => {
  it("erases the inbox and preferences, counts them, and a second erase counts zero", async () => {
    const { notifier, deps, send } = setup();
    await send("human", "ana");
    await send("human", "ana");
    await send("human", "bob");
    await notifier.setPreferences({ kind: "human", id: "ana" }, { channels: {}, muted: true, mutedTypes: [] });
    expect(await notifyAccount.eraseAccount(ANA, deps)).toStrictEqual({ notifications: 2, preferences: 1 });
    expect(await notifyAccount.exportAccount(ANA, deps)).toStrictEqual({ notifications: [], preferences: [] });
    expect(await notifyAccount.eraseAccount(ANA, deps)).toStrictEqual({ notifications: 0, preferences: 0 });
    expect((await notifyAccount.exportAccount(BOB, deps)).notifications).toHaveLength(1);
  });

  it("still erases when a stored doc is malformed, through the subpath entry", async () => {
    const store = createMemoryStore();
    const notifier = createNotifier({ store });
    await store.put("notifications", "bad", { id: "bad", recipientKey: "human:ana", createdAt: "x" });
    expect(await fromSubpath.eraseAccount(ANA, { notifier })).toStrictEqual({ notifications: 1, preferences: 0 });
  });

  it("leaves notifications that name the subject only as actor", async () => {
    const { deps, send } = setup();
    await send("human", "bob", { kind: "human", id: "ana" });
    await notifyAccount.eraseAccount(ANA, deps);
    expect((await notifyAccount.exportAccount(BOB, deps)).notifications).toHaveLength(1);
  });
});
