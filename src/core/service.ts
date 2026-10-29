import { z } from "zod";
import { eraseRecipient, exportRecipient, NOTES, PREFS, sweepBefore } from "./gdpr.js";
import type { Doc, Store } from "agentic-identity";
import {
  DEFAULT_CHANNELS,
  defaultPreferences,
  notificationSchema,
  preferencesSchema,
  recipientKey,
  recipientSchema,
  sendInputSchema,
  typeNameSchema,
  type Channel,
  type Digest,
  type Notification,
  type Preferences,
  type Recipient,
  type SendInput,
} from "./types.js";


export interface NotifierOptions {
  store: Store;
  now?: () => number;
  newId?: () => string;
  /** Notifications older than this many milliseconds go on `sweep`. Unset keeps them. */
  retentionMs?: number;
}

export interface SendResult {
  /** Null only when the recipient muted the type. */
  notification: Notification | null;
  /** True when the notification went to the inbox. Only then can `get` and `markRead` find its id. */
  stored: boolean;
  /** Channels the delivery layer must serve. Empty when muted. */
  channels: Channel[];
  muted: boolean;
}

export interface ListOptions {
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export interface ListResult {
  items: Notification[];
  nextCursor: string | null;
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(message = "notification not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

function toDoc(n: Notification): Doc {
  return { ...n, recipientKey: recipientKey(n.recipient) } as Doc;
}

function fromDoc(doc: Doc): Notification {
  const { recipientKey: _drop, ...rest } = doc;
  return notificationSchema.parse(rest);
}

/**
 * A cursor is base64url of JSON `[createdAt, id]`. The port does not check the type of the sort value,
 * so a forged cursor could cut the list in an arbitrary place. Refuse anything else.
 */
function checkCursor(cursor: string): void {
  try {
    const bytes = Uint8Array.from(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isFinite(parsed[0]) && typeof parsed[1] === "string") return;
  } catch {
    // fall through
  }
  throw new RangeError("bad cursor");
}

export function createNotifier(options: NotifierOptions) {
  const { store } = options;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => crypto.randomUUID());
  if (options.retentionMs !== undefined && !(Number.isInteger(options.retentionMs) && options.retentionMs > 0)) {
    throw new RangeError("retentionMs must be a positive integer");
  }

  async function getPreferences(recipient: Recipient): Promise<Preferences> {
    const r = recipientSchema.parse(recipient);
    const doc = await store.get(PREFS, recipientKey(r));
    return doc ? preferencesSchema.parse(doc) : defaultPreferences();
  }

  async function setPreferences(recipient: Recipient, prefs: Preferences): Promise<Preferences> {
    const r = recipientSchema.parse(recipient);
    const valid = preferencesSchema.parse(prefs);
    await store.put(PREFS, recipientKey(r), valid);
    return valid;
  }

  async function send(input: SendInput): Promise<SendResult> {
    const valid = sendInputSchema.parse(input);
    const prefs = await getPreferences(valid.recipient);
    if (prefs.muted || prefs.mutedTypes.includes(valid.type)) {
      return { notification: null, stored: false, channels: [], muted: true };
    }
    const own = Object.hasOwn(prefs.channels, valid.type) ? prefs.channels[valid.type] : undefined;
    const channels = [...(own ?? DEFAULT_CHANNELS)];
    // Check the clock and id source too, so a bad value never reaches the store.
    const notification = notificationSchema.parse({
      ...valid,
      id: newId(),
      createdAt: now(),
      readAt: null,
    });
    if (!channels.includes("inbox")) return { notification, stored: false, channels, muted: false };
    await store.transaction(async (tx) => {
      if (await tx.get(NOTES, notification.id)) throw new Error("notification id collision");
      await tx.put(NOTES, notification.id, toDoc(notification));
    });
    return { notification, stored: true, channels, muted: false };
  }

  async function list(recipient: Recipient, opts: ListOptions = {}): Promise<ListResult> {
    const r = recipientSchema.parse(recipient);
    const where: Record<string, string | null> = { recipientKey: recipientKey(r) };
    if (opts.unreadOnly) where.readAt = null;
    if (opts.cursor !== undefined) checkCursor(opts.cursor);
    const page = await store.query(NOTES, {
      where,
      orderBy: { field: "createdAt", direction: "desc" },
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return { items: page.items.map((i) => fromDoc(i.data)), nextCursor: page.nextCursor ?? null };
  }

  function check(doc: Doc | null, recipient: Recipient): Doc {
    // A record that belongs to someone else looks like a missing one.
    if (!doc || doc.recipientKey !== recipientKey(recipient)) throw new NotFoundError();
    return doc;
  }

  async function get(recipient: Recipient, id: string): Promise<Notification> {
    const r = recipientSchema.parse(recipient);
    return fromDoc(check(await store.get(NOTES, id), r));
  }

  async function markReadOnce(recipient: Recipient, id: string): Promise<{ notification: Notification; won: boolean }> {
    const r = recipientSchema.parse(recipient);
    // The transaction runs again when the doc changed, so only one racing caller wins.
    return store.transaction(async (tx) => {
      const n = fromDoc(check(await tx.get(NOTES, id), r));
      if (n.readAt !== null) return { notification: n, won: false };
      const next = notificationSchema.parse({ ...n, readAt: now() });
      await tx.put(NOTES, id, toDoc(next));
      return { notification: next, won: true };
    });
  }

  async function markRead(recipient: Recipient, id: string): Promise<Notification> {
    return (await markReadOnce(recipient, id)).notification;
  }

  async function markAllRead(recipient: Recipient): Promise<number> {
    let count = 0;
    const tried = new Set<string>();
    for (;;) {
      const page = await list(recipient, { unreadOnly: true, limit: 100 });
      // Try each id once. A store that filters wrongly then cannot loop forever,
      // and losing a race for an item does not end the run.
      const fresh = page.items.filter((n) => !tried.has(n.id));
      if (fresh.length === 0) return count;
      for (const n of fresh) {
        tried.add(n.id);
        // Count only our own wins, so two concurrent calls do not both claim an item.
        if ((await markReadOnce(recipient, n.id)).won) count++;
      }
    }
  }

  async function unreadCount(recipient: Recipient): Promise<number> {
    let count = 0;
    let cursor: string | undefined;
    do {
      const page = await list(recipient, { unreadOnly: true, limit: 200, cursor });
      count += page.items.length;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return count;
  }

  /** Group the unread notifications created at or after `since`. */
  async function digest(recipient: Recipient, since = 0): Promise<Digest> {
    since = z.number().int().nonnegative().parse(since);
    const groups = new Map<string, { count: number; latest: Notification }>();
    let total = 0;
    let cursor: string | undefined;
    do {
      const page = await list(recipient, { unreadOnly: true, limit: 200, cursor });
      for (const n of page.items) {
        if (n.createdAt < since) continue;
        total++;
        const g = groups.get(n.type);
        if (!g) groups.set(n.type, { count: 1, latest: n });
        else g.count++; // pages come newest first, so the first seen is the latest
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return {
      total,
      groups: [...groups].map(([type, g]) => ({ type, ...g })).sort((a, b) => b.latest.createdAt - a.latest.createdAt),
    };
  }

  /** Export everything held about one recipient. */
  async function exportData(recipient: Recipient) {
    return exportRecipient(store, recipientSchema.parse(recipient));
  }

  /** Hard delete one recipient's notifications and preferences. */
  async function erase(recipient: Recipient): Promise<{ notifications: number }> {
    return { notifications: await eraseRecipient(store, recipientSchema.parse(recipient)) };
  }

  /** Delete notifications past the retention window. A no-op when no retention is set. */
  async function sweep(): Promise<number> {
    if (options.retentionMs === undefined) return 0;
    return sweepBefore(store, now() - options.retentionMs);
  }

  function parseType(type: string): string {
    return typeNameSchema.parse(type);
  }

  return {
    send,
    list,
    get,
    markRead,
    markAllRead,
    unreadCount,
    digest,
    getPreferences,
    setPreferences,
    parseType,
    exportData,
    erase,
    sweep,
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
