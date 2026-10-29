import type { Digest, Notification, Preferences, Recipient, ResourceRef } from "./core/types.js";
import type { RecipientExport } from "./core/gdpr.js";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`request failed: ${status} ${code}`);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export interface SendRequest {
  recipient: Recipient;
  type: string;
  resource: ResourceRef;
  body: string;
}

export interface SendResponse {
  notification: Notification | null;
  stored: boolean;
  muted: boolean;
  /** Channels the recipient chose. Absent when a dispatcher answers: see `deliveries`. */
  channels?: string[];
  /** Per channel outcome for the non-inbox channels. `skipped` means nothing was sent. */
  deliveries: { channel: string; ok: boolean; error?: string; skipped?: "no_target" | "no_channel" }[];
}

export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
}

export function createClient(options: ClientOptions) {
  if (!options.token) throw new Error("token is required");
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown;
    let valid = true;
    try {
      parsed = JSON.parse(text);
    } catch {
      valid = false;
    }
    if (!res.ok) {
      const code = valid ? (parsed as { error?: unknown } | null)?.error : undefined;
      throw new ApiError(res.status, typeof code === "string" ? code : "error");
    }
    // A 2xx that is not JSON means the wrong host or a proxy. Do not call it success.
    if (!valid) throw new ApiError(res.status, "bad_response");
    return parsed as T;
  }

  const qs = (params: Record<string, string | number | boolean | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== false) u.set(k, String(v === true ? "1" : v));
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  return {
    list: (o: { unreadOnly?: boolean; limit?: number; cursor?: string } = {}) =>
      call<NotificationPage>("GET", `/notifications${qs({ unread: o.unreadOnly, limit: o.limit, cursor: o.cursor })}`),
    get: (id: string) => call<Notification>("GET", `/notifications/${encodeURIComponent(id)}`),
    markRead: (id: string) => call<Notification>("POST", `/notifications/${encodeURIComponent(id)}/read`),
    markAllRead: () => call<{ marked: number }>("POST", "/notifications/read-all"),
    unreadCount: () => call<{ count: number }>("GET", "/unread-count"),
    digest: (since?: number) => call<Digest>("GET", `/digest${qs({ since })}`),
    getPreferences: () => call<Preferences>("GET", "/preferences"),
    setPreferences: (prefs: Preferences) => call<Preferences>("PUT", "/preferences", prefs),
    send: (request: SendRequest) => call<SendResponse>("POST", "/notifications", request),
    exportData: () => call<RecipientExport>("GET", "/me/export"),
    erase: () => call<{ notifications: number }>("DELETE", "/me"),
  };
}

export type Client = ReturnType<typeof createClient>;
