import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createClient } from "../src/sdk.js";
import type { Notification } from "../src/core/types.js";

export interface NotifyUiOptions {
  /** The Worker origin as an absolute URL, for example "https://notify.example.com". */
  baseUrl: string;
  /** Called before each request. Return the bearer token of the signed-in person or agent. The server checks every call against it. */
  getToken: () => string | Promise<string>;
  /** Milliseconds between refreshes while the page is visible. Default 15000. Use 0 to turn polling off. */
  pollMs?: number;
  /** How many notifications the list holds. Default 20. */
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
  /** A message for a person, or null. The last good list stays in `items`. */
  error: string | null;
  /** True while a mark call runs. */
  busy: boolean;
  refresh(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return "The token was not accepted.";
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return "The server refused the request.";
  return "Notifications could not be loaded. Try again.";
}

/** Check the options once, so a bad value fails at the call site and not on the first poll. */
export function checkOptions(options: NotifyUiOptions): void {
  if (!options || typeof options.getToken !== "function") throw new TypeError("the notifications UI needs a getToken function");
  createClient({ baseUrl: options.baseUrl, token: "check" });
  const url = new URL(options.baseUrl);
  if (url.username || url.password) throw new TypeError("baseUrl must not hold user info");
}

/**
 * The inbox of the signed-in caller, kept fresh over the notify HTTP API. It reads the list and the
 * unread count on mount, on every poll while the page is visible, and when the page becomes visible.
 * A refused call sets `error`. It never shows a failed call as success.
 */
export function useNotifications(options: NotifyUiOptions): NotificationsState {
  const { baseUrl, getToken, pollMs = 15_000, limit = 20, fetch: doFetch } = options;
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const alive = useRef(true);

  const api = useCallback(async () => createClient({ baseUrl, token: await getToken(), fetch: doFetch }), [baseUrl, getToken, doFetch]);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const client = await api();
      const [page, count] = await Promise.all([client.list({ limit }), client.unreadCount()]);
      // A newer refresh started: its answer wins.
      if (!alive.current || ticket !== latest.current) return;
      setItems(page.items);
      setUnread(count.count);
      setError(null);
    } catch (e) {
      if (!alive.current || ticket !== latest.current) return;
      setError(describeError(e));
    } finally {
      if (alive.current && ticket === latest.current) setLoading(false);
    }
  }, [api, limit]);

  const mutate = useCallback(
    async (run: (client: Awaited<ReturnType<typeof api>>) => Promise<unknown>) => {
      setBusy(true);
      try {
        await run(await api());
      } catch (e) {
        if (alive.current) setError(describeError(e));
        return;
      } finally {
        if (alive.current) setBusy(false);
      }
      await refresh();
    },
    [api, refresh],
  );

  const markRead = useCallback((id: string) => mutate((c) => c.markRead(id)), [mutate]);
  const markAllRead = useCallback(() => mutate((c) => c.markAllRead()), [mutate]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const visible = () => document.visibilityState === "visible";
    const tick = () => visible() && void refresh();
    const timer = pollMs > 0 ? setInterval(tick, pollMs) : undefined;
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, pollMs]);

  return { items, unread, loading, error, busy, refresh, markRead, markAllRead };
}
