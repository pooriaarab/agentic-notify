import { DeliveryError, type DeliveryChannel } from "./types.js";
import type { Notification, Recipient } from "../core/types.js";

const enc = new TextEncoder();
export const MIN_SECRET_BYTES = 32;
export const SIGNATURE_HEADER = "x-notify-signature";
const DEFAULT_TOLERANCE_SECONDS = 300;

function assertSecret(secret: unknown): string {
  if (typeof secret !== "string" || enc.encode(secret).length < MIN_SECRET_BYTES) {
    throw new Error(`webhook secret must be a string of at least ${MIN_SECRET_BYTES} bytes`);
  }
  return secret;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(assertSecret(secret)), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Header value: `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<body>">`. */
export async function signPayload(secret: string, body: string, timestamp: number): Promise<string> {
  if (!Number.isInteger(timestamp) || timestamp < 0) throw new RangeError("timestamp must be a unix time in seconds");
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(`${timestamp}.${body}`));
  return `t=${timestamp},v1=${hex(sig)}`;
}

/** Returns false for any malformed, stale, future or wrong signature. Throws only on a bad secret. */
export async function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  options: { now?: number; toleranceSeconds?: number } = {},
): Promise<boolean> {
  const key = await hmacKey(secret, "verify");
  if (typeof header !== "string") return false;
  const m = /^t=(\d{1,15}),v1=([0-9a-f]+)$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(now) || !Number.isFinite(tolerance) || Math.abs(now - t) > tolerance) return false;
  const sig = fromHex(m[2]!);
  if (!sig) return false;
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(`${t}.${body}`));
}

export interface WebhookTarget {
  url: string;
  secret: string;
}

export interface WebhookOptions {
  /** Find the endpoint for a recipient. Return null when none is set. */
  resolve(recipient: Recipient): Promise<WebhookTarget | null> | WebhookTarget | null;
  fetch?: typeof fetch;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  /** Allow http:// targets. Off by default. */
  allowInsecure?: boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export function webhookBody(n: Notification): string {
  return JSON.stringify({
    id: n.id,
    type: n.type,
    recipient: n.recipient,
    resource: n.resource,
    actor: n.actor,
    body: n.body,
    createdAt: n.createdAt,
  });
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createWebhookChannel(options: WebhookOptions): DeliveryChannel {
  const doFetch = options.fetch ?? fetch;
  const maxAttempts = options.maxAttempts ?? 4;
  const base = options.baseDelayMs ?? 500;
  const cap = options.maxDelayMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => Date.now());
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts must be 1 or more");

  return {
    async deliver(n) {
      const target = await options.resolve(n.recipient);
      if (!target) return;
      assertSecret(target.secret);
      const url = new URL(target.url);
      if (url.protocol !== "https:" && !(options.allowInsecure && url.protocol === "http:")) {
        throw new DeliveryError("webhook url must use https", 0);
      }
      const body = webhookBody(n);
      let lastReason = "";
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Sign per attempt so a retry after a long wait stays inside the replay window.
        const signature = await signPayload(target.secret, body, Math.floor(now() / 1000));
        let retry = true;
        try {
          const res = await doFetch(url.toString(), {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
            headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature, "x-notify-id": n.id },
            body,
          });
          if (res.status >= 200 && res.status < 300) return;
          lastReason = `status ${res.status}`;
          retry = retryable(res.status);
        } catch (error) {
          lastReason = error instanceof Error ? error.name : "error";
        }
        if (!retry) throw new DeliveryError(`webhook failed: ${lastReason}`, attempt);
        if (attempt < maxAttempts) {
          const delay = Math.min(cap, base * 2 ** (attempt - 1));
          await sleep(Math.floor(delay / 2 + random() * (delay / 2)));
        }
      }
      throw new DeliveryError(`webhook failed: ${lastReason}`, maxAttempts);
    },
  };
}
