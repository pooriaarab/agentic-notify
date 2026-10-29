import { z } from "zod";
import type { Store } from "./store.js";
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

const NOTES = "notifications";
const PREFS = "preferences";

export interface NotifierOptions {
  store: Store;
  now?: () => number;
  newId?: () => string;
}

export interface SendResult {
  /** Null only when the recipient muted the type. */
  notification: Notification | null;
  /** True when the notification went to the inbox. */
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

function toDoc(n: Notification): Record<string, unknown> {
  return { ...n, recipientKey: recipientKey(n.recipient) };
}

function fromDoc(doc: Record<string, unknown>): Notification {
  const { recipientKey: _drop, ...rest } = doc;
  return notificationSchema.parse(rest);
}

export function createNotifier(options: NotifierOptions) {
  const { store } = options;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => crypto.randomUUID());

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
    if (!(await store.create(NOTES, notification.id, toDoc(notification)))) {
      throw new Error("notification id collision");
    }
    return { notification, stored: true, channels, muted: false };
  }

  async function list(recipient: Recipient, opts: ListOptions = {}): Promise<ListResult> {
    const r = recipientSchema.parse(recipient);
    const where: Record<string, string | null> = { recipientKey: recipientKey(r) };
    if (opts.unreadOnly) where.readAt = null;
    const page = await store.query(NOTES, {
      where,
      orderBy: { field: "createdAt", direction: "desc" },
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return { items: page.items.map((i) => fromDoc(i.doc)), nextCursor: page.nextCursor };
  }

  async function load(recipient: Recipient, id: string) {
    const r = recipientSchema.parse(recipient);
    const doc = await store.get(NOTES, id);
    // A record that belongs to someone else looks like a missing one.
    if (!doc || doc.recipientKey !== recipientKey(r)) throw new NotFoundError();
    return doc;
  }

  async function get(recipient: Recipient, id: string): Promise<Notification> {
    return fromDoc(await load(recipient, id));
  }

  async function markReadOnce(recipient: Recipient, id: string): Promise<{ notification: Notification; won: boolean }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await load(recipient, id);
      const n = fromDoc(doc);
      if (n.readAt !== null) return { notification: n, won: false };
      const next = notificationSchema.parse({ ...n, readAt: now() });
      if (await store.replaceIf(NOTES, id, doc, toDoc(next))) return { notification: next, won: true };
    }
    throw new Error("could not mark read: too much contention");
  }

  async function markRead(recipient: Recipient, id: string): Promise<Notification> {
    return (await markReadOnce(recipient, id)).notification;
  }

  async function markAllRead(recipient: Recipient): Promise<number> {
    let count = 0;
    for (;;) {
      const page = await list(recipient, { unreadOnly: true, limit: 100 });
      let progress = 0;
      // Count only our own wins, so two concurrent calls do not both claim an item.
      for (const n of page.items) if ((await markReadOnce(recipient, n.id)).won) progress++;
      count += progress;
      // Stop on an empty pass, so a store that filters wrongly cannot loop forever.
      if (progress === 0) return count;
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
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
