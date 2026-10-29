import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { DeliveryError } from "./types.js";
import { createWebhookChannel, signPayload, SIGNATURE_HEADER, verifySignature, webhookBody } from "./webhook.js";
import type { Notification } from "../core/types.js";

const SECRET = "s".repeat(32);
const n: Notification = {
  id: "n1",
  recipient: { kind: "agent", id: "helper" },
  type: "approval_request",
  resource: { kind: "doc", id: "d1" },
  actor: { kind: "human", id: "ana" },
  body: "please approve",
  createdAt: 1,
  readAt: null,
};

describe("signature", () => {
  test("round trips and rejects a changed body or secret", async () => {
    const h = await signPayload(SECRET, "{}", 1000);
    expect(await verifySignature(SECRET, "{}", h, { now: 1000 })).toBe(true);
    expect(await verifySignature(SECRET, "{ }", h, { now: 1000 })).toBe(false);
    expect(await verifySignature("t".repeat(32), "{}", h, { now: 1000 })).toBe(false);
  });

  test("rejects stale, future, malformed and missing headers", async () => {
    const h = await signPayload(SECRET, "{}", 1000);
    expect(await verifySignature(SECRET, "{}", h, { now: 1301 })).toBe(false);
    expect(await verifySignature(SECRET, "{}", h, { now: 699 })).toBe(false);
    expect(await verifySignature(SECRET, "{}", h, { now: 1300 })).toBe(true);
    for (const bad of ["", "t=1", "v1=ab", "t=1000,v1=zz", "t=1000,v1=abc", `${h},extra`, null, undefined]) {
      expect(await verifySignature(SECRET, "{}", bad, { now: 1000 })).toBe(false);
    }
    expect(await verifySignature(SECRET, "{}", h, { now: Number.NaN })).toBe(false);
    expect(await verifySignature(SECRET, "{}", h, { now: 1000, toleranceSeconds: Number.NaN })).toBe(false);
  });

  test("bad timing options are refused when the channel is made", () => {
    for (const bad of [{ baseDelayMs: Number.NaN }, { baseDelayMs: -1 }, { maxDelayMs: Number.NaN }, { timeoutMs: -5 }, { timeoutMs: Number.NaN }]) {
      expect(() => createWebhookChannel({ resolve: () => null, ...bad })).toThrow(RangeError);
    }
  });

  test("a missing, empty or short secret throws", async () => {
    for (const bad of [undefined, null, "", "short", "é".repeat(15), 42]) {
      await expect(signPayload(bad as never, "{}", 1)).rejects.toThrow(/32 bytes/);
      await expect(verifySignature(bad as never, "{}", "t=1,v1=00", { now: 1 })).rejects.toThrow(/32 bytes/);
    }
    await expect(signPayload("é".repeat(16), "{}", 1)).resolves.toBeTypeOf("string");
  });
});

function harness(statuses: (number | "throw")[], extra: Record<string, unknown> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const s = statuses[Math.min(i++, statuses.length - 1)]!;
    if (s === "throw") throw new TypeError("network");
    return new Response(null, { status: s });
  }) as unknown as typeof fetch;
  const channel = createWebhookChannel({
    resolve: () => ({ url: "https://hooks.example/n", secret: SECRET }),
    fetch: fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
    now: () => 5_000_000,
    ...extra,
  });
  return { channel, calls, sleeps };
}

describe("retry", () => {
  test("retries 5xx and network errors with doubling backoff, then succeeds", async () => {
    const h = harness([500, "throw", 429, 200]);
    await h.channel.deliver(n);
    expect(h.calls).toHaveLength(4);
    expect(h.sleeps).toEqual([500, 1000, 2000]);
  });

  test("backoff is capped", async () => {
    const h = harness([500], { maxAttempts: 6, maxDelayMs: 1500 });
    await expect(h.channel.deliver(n)).rejects.toBeInstanceOf(DeliveryError);
    expect(h.sleeps).toEqual([500, 1000, 1500, 1500, 1500]);
  });

  test("gives up after maxAttempts with a DeliveryError that carries no payload", async () => {
    const h = harness([503]);
    const err = (await h.channel.deliver(n).catch((e: unknown) => e)) as DeliveryError;
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.attempts).toBe(4);
    expect(err.message).not.toContain(n.body);
  });

  test("does not retry other 4xx or redirects", async () => {
    for (const status of [400, 401, 404, 302]) {
      const h = harness([status]);
      await expect(h.channel.deliver(n)).rejects.toMatchObject({ attempts: 1 });
      expect(h.calls).toHaveLength(1);
    }
  });

  test("sends a verifiable signature and refuses redirects", async () => {
    const h = harness([200]);
    await h.channel.deliver(n);
    const { init } = h.calls[0]!;
    const sig = (init.headers as Record<string, string>)[SIGNATURE_HEADER]!;
    expect(init.redirect).toBe("manual");
    expect(await verifySignature(SECRET, init.body as string, sig, { now: 5000 })).toBe(true);
  });
});

describe("targets", () => {
  test("no endpoint means no call", async () => {
    const h = harness([200], { resolve: () => null });
    expect(await h.channel.deliver(n)).toBe("skipped");
    expect(h.calls).toHaveLength(0);
  });

  test("refuses http unless allowed, and a short secret", async () => {
    const http = harness([200], { resolve: () => ({ url: "http://hooks.example/n", secret: SECRET }) });
    await expect(http.channel.deliver(n)).rejects.toThrow(/https/);
    const short = harness([200], { resolve: () => ({ url: "https://hooks.example/n", secret: "short" }) });
    await expect(short.channel.deliver(n)).rejects.toThrow(/32 bytes/);
    expect(short.calls).toHaveLength(0);
  });

  test("a real HTTP server receives a body whose signature verifies", async () => {
    const got: { body: string; sig: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        got.push({ body, sig: String(req.headers[SIGNATURE_HEADER]) });
        res.statusCode = got.length === 1 ? 500 : 204;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const channel = createWebhookChannel({
        resolve: () => ({ url: `http://127.0.0.1:${port}/hook`, secret: SECRET }),
        allowInsecure: true,
        baseDelayMs: 1,
      });
      await channel.deliver(n);
      expect(got).toHaveLength(2);
      expect(got[1]!.body).toBe(webhookBody(n));
      expect(await verifySignature(SECRET, got[1]!.body, got[1]!.sig)).toBe(true);
    } finally {
      server.close();
    }
  });
});
