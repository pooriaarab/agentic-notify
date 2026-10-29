import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createClient } from "../src/sdk.js";
import type { Notification } from "../src/core/types.js";

export interface NotifyUiOptions {
  /** The Worker origin as an absolute URL, for example "https://notify.example.com". */
  baseUrl: string;
  /** Called before each request. Return the bearer token of the signed-in person or agent. The server checks every call against it. */
  getToken: () => string | Promise<string>;
  /** Milliseconds between refreshes while the page is visible. Default 15000. Use 0 to turn polling off, or at least 1000. */
  pollMs?: number;
  /** How many notifications the list holds. Default 20, from 1 to 100. */
  limit?: number;
  /** A fetch to use in place of the global one. */
  fetch?: typeof fetch;
}

export interface NotificationsState {
  items: Notification[];
  /** The true unread count from the server. It can be higher than the unread items in `items`. */
  unread: number;
  /** True until the first answer or the first error. */
  loading: boolean;
  /** A load failure for a person, or null. The last good list stays in `items`. */
  error: string | null;
  /** A failed mark call, or null. It stays until the next mark call starts. A refresh does not clear it. */
  actionError: string | null;
  /** True while a mark call runs. */
  busy: boolean;
  refresh(): Promise<void>;
  /** Hide the failed-mark message. */
  dismissError(): void;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

export function describeError(error: unknown, action = "Notifications could not be loaded. Try again."): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return "The token was not accepted.";
  if (error instanceof ApiError && error.status === 429) return "Too many requests. Wait a moment, then try again.";
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return "The server refused the request.";
  return action;
}

/** Check the options once, so a bad value fails at the call site and not on the first poll. */
export function checkOptions(options: NotifyUiOptions): void {
  if (!options || typeof options.getToken !== "function") throw new TypeError("the notifications UI needs a getToken function");
  createClient({ baseUrl: options.baseUrl, token: "check" });
  const url = new URL(options.baseUrl);
  if (url.username || url.password) throw new TypeError("baseUrl must not hold user info");
  // The bearer token crosses this link on every poll. Plain http is for a local Worker only.
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new TypeError("baseUrl must use https");
  const { pollMs, limit } = options;
  if (pollMs !== undefined && !(pollMs === 0 || (Number.isFinite(pollMs) && pollMs >= 1000 && pollMs <= 2_147_483_647))) throw new TypeError("pollMs must be 0 or from 1000 to 2147483647");
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 100)) throw new TypeError("limit must be a whole number from 1 to 100");
}

/**
 * The inbox of the signed-in caller, kept fresh over the notify HTTP API. It reads the list and the
 * unread count on mount, on every poll while the page is visible, and when the page becomes visible.
 * A refused call sets `error`. It never shows a failed call as success.
 * It does not reload when `getToken` changes. When the caller changes, remount the host with a new `key`.
 */
export function useNotifications(options: NotifyUiOptions): NotificationsState {
  checkOptions(options);
  const { baseUrl, pollMs = 15_000, limit = 20 } = options;
  // Held in refs, so an inline `getToken` does not restart the polling on each render of the host.
  const getToken = useRef(options.getToken);
  const doFetch = useRef(options.fetch);
  getToken.current = options.getToken;
  doFetch.current = options.fetch;
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const alive = useRef(true);

  // A slow network ends in an error after 10 seconds, and not in a list that loads forever.
  const timed: typeof fetch = useCallback((input, init) => (doFetch.current ?? fetch)(input, { ...init, signal: AbortSignal.timeout(10_000) }), []);
  const api = useCallback(async () => {
    // The wait for the token is under the same deadline as the calls.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("token timeout")), 10_000)));
    try {
      // A getToken that throws means the session is gone: treat it as a refused token.
      const token = await Promise.race([Promise.resolve().then(() => getToken.current()), deadline]).catch((e: unknown) => {
        if (e instanceof Error && e.message === "token timeout") throw e;
        return "";
      });
      // Signed out is a refused token, not a network failure.
      if (!token) throw new ApiError(401, "unauthorized");
      return createClient({ baseUrl, token, fetch: timed });
    } finally {
      clearTimeout(timer);
    }
  }, [baseUrl, timed]);
  const inFlight = useRef(false);
  // After a refused token the polling stops. After a 429 it pauses for a minute. A person's own action or `refresh()` starts it again.
  const refused = useRef(false);
  const pausedUntil = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    inFlight.current = true;
    refused.current = false;
    try {
      const client = await api();
      const [page, count] = await Promise.all([client.list({ limit }), client.unreadCount()]);
      // A newer refresh started: its answer wins.
      if (!alive.current || ticket !== latest.current) return;
      // A wrong host or a proxy can answer 200 with another shape. That is a failure, not an empty inbox.
      if (!Array.isArray(page?.items) || typeof count?.count !== "number") throw new ApiError(200, "bad_response");
      setItems(page.items);
      setUnread(count.count);
      setError(null);
    } catch (e) {
      if (!alive.current || ticket !== latest.current) return;
      refused.current = e instanceof ApiError && (e.status === 401 || e.status === 403);
      // A rate limit is temporary: pause the polling for a minute.
      if (e instanceof ApiError && e.status === 429) pausedUntil.current = Date.now() + 60_000;
      setError(describeError(e));
    } finally {
      if (ticket === latest.current) inFlight.current = false;
      if (alive.current && ticket === latest.current) setLoading(false);
    }
  }, [api, limit]);

  const mutate = useCallback(
    async (run: (client: Awaited<ReturnType<typeof api>>) => Promise<unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await run(await api());
        // Busy stays on until the list is fresh, so a second press cannot send a second call.
        await refresh();
      } catch (e) {
        const noScope = e instanceof ApiError && e.status === 403;
        if (alive.current) setActionError(noScope ? "This token cannot make that change. It needs the notify:write scope." : describeError(e, "The change was not saved. Try again."));
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [api, refresh],
  );

  const markRead = useCallback((id: string) => mutate((c) => c.markRead(id)), [mutate]);
  const markAllRead = useCallback(() => mutate((c) => c.markAllRead()), [mutate]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const visible = () => document.visibilityState === "visible";
    // A poll does not start while an earlier call runs or after a refused token.
    const tick = () => visible() && !inFlight.current && !refused.current && Date.now() >= pausedUntil.current && void refresh();
    const timer = pollMs > 0 ? setInterval(tick, pollMs) : undefined;
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, pollMs]);

  const dismissError = useCallback(() => setActionError(null), []);

  return { items, unread, loading, error, actionError, busy, dismissError, refresh, markRead, markAllRead };
}
