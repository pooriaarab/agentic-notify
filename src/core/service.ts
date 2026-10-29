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
  /** Null when the inbox channel is off or the recipient muted the type. */
  notification: Notification | null;
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
      return { notification: null, channels: [], muted: true };
    }
    const channels = [...(prefs.channels[valid.type] ?? DEFAULT_CHANNELS)];
    if (!channels.includes("inbox")) return { notification: null, channels, muted: false };
    const notification: Notification = {
      ...valid,
      id: newId(),
      createdAt: now(),
      readAt: null,
    };
    if (!(await store.create(NOTES, notification.id, toDoc(notification)))) {
      throw new Error("notification id collision");
    }
    return { notification, channels, muted: false };
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

  async function markRead(recipient: Recipient, id: string): Promise<Notification> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await load(recipient, id);
      const n = fromDoc(doc);
      if (n.readAt !== null) return n;
      const next = { ...n, readAt: now() };
      if (await store.replaceIf(NOTES, id, doc, toDoc(next))) return next;
    }
    throw new Error("could not mark read: too much contention");
  }

  async function markAllRead(recipient: Recipient): Promise<number> {
    let count = 0;
    for (;;) {
      const page = await list(recipient, { unreadOnly: true, limit: 100 });
      if (page.items.length === 0) return count;
      for (const n of page.items) {
        const was = n.readAt;
        const done = await markRead(recipient, n.id);
        if (was === null && done.readAt !== null) count++;
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
