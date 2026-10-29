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
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep null
    }
    if (!res.ok) {
      const code = (parsed as { error?: unknown } | null)?.error;
      throw new ApiError(res.status, typeof code === "string" ? code : "error");
    }
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
    send: (request: SendRequest) =>
      call<{ notification: Notification | null; stored: boolean; muted: boolean }>("POST", "/notifications", request),
    exportData: () => call<RecipientExport>("GET", "/me/export"),
    erase: () => call<{ notifications: number }>("DELETE", "/me"),
  };
}

export type Client = ReturnType<typeof createClient>;
