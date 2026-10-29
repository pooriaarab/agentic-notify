import type { Store } from "./store.js";
import { notificationSchema, preferencesSchema, recipientKey, type Notification, type Preferences, type Recipient } from "./types.js";

export const NOTES = "notifications";
export const PREFS = "preferences";

export interface RecipientExport {
  recipient: Recipient;
  preferences: Preferences | null;
  notifications: Notification[];
}

async function* notificationDocs(store: Store, recipient: Recipient) {
  let cursor: string | undefined;
  do {
    const page = await store.query(NOTES, {
      where: { recipientKey: recipientKey(recipient) },
      orderBy: { field: "createdAt", direction: "asc" },
      limit: 200,
      cursor,
    });
    yield* page.items;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}

/** Everything held about one recipient, as plain JSON. */
export async function exportRecipient(store: Store, recipient: Recipient): Promise<RecipientExport> {
  const notifications: Notification[] = [];
  for await (const item of notificationDocs(store, recipient)) {
    const { recipientKey: _drop, ...rest } = item.doc;
    notifications.push(notificationSchema.parse(rest));
  }
  const prefs = await store.get(PREFS, recipientKey(recipient));
  return { recipient, preferences: prefs ? preferencesSchema.parse(prefs) : null, notifications };
}

/** Hard delete. Returns how many notifications went. Safe to repeat. */
export async function eraseRecipient(store: Store, recipient: Recipient): Promise<number> {
  const ids: string[] = [];
  for await (const item of notificationDocs(store, recipient)) ids.push(item.id);
  for (const id of ids) await store.delete(NOTES, id);
  await store.delete(PREFS, recipientKey(recipient));
  return ids.length;
}

/** Delete notifications created before `cutoff`, for every recipient. Returns the count. */
export async function sweepBefore(store: Store, cutoff: number): Promise<number> {
  if (!Number.isFinite(cutoff)) throw new RangeError("cutoff must be a finite number");
  let removed = 0;
  for (;;) {
    // Oldest first, so the first page that holds a young doc is the last one to visit.
    const page = await store.query(NOTES, { orderBy: { field: "createdAt", direction: "asc" }, limit: 200 });
    const old = page.items.filter((i) => typeof i.doc.createdAt !== "number" || i.doc.createdAt < cutoff);
    for (const item of old) await store.delete(NOTES, item.id);
    removed += old.length;
    if (old.length < page.items.length || page.items.length === 0) return removed;
  }
}
