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

/**
 * Hard delete of what is held about one recipient: their notifications and preferences.
 * It does not touch notifications where this principal is only the actor; those belong to
 * other recipients. Repeats until a pass finds nothing, so a send during the erase is caught
 * unless it lands after the final pass. Returns how many notifications went.
 */
export async function eraseRecipient(store: Store, recipient: Recipient): Promise<number> {
  let removed = 0;
  for (;;) {
    const ids: string[] = [];
    for await (const item of notificationDocs(store, recipient)) ids.push(item.id);
    if (ids.length === 0) break;
    for (const id of ids) await store.delete(NOTES, id);
    removed += ids.length;
  }
  await store.delete(PREFS, recipientKey(recipient));
  return removed;
}

/**
 * Delete notifications created before `cutoff`, for every recipient. Returns the count.
 * A doc whose createdAt is not a number is left alone: retention does not guess.
 */
export async function sweepBefore(store: Store, cutoff: number): Promise<number> {
  if (!Number.isFinite(cutoff)) throw new RangeError("cutoff must be a finite number");
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    // Oldest first: stop at the first page that reaches a young doc.
    let page;
    try {
      page = await store.query(NOTES, { orderBy: { field: "createdAt", direction: "asc" }, limit: 200, cursor });
    } catch (error) {
      // Mixed types in createdAt make a cursor unusable. Stop and keep what we have.
      if (error instanceof RangeError && cursor !== undefined) return removed;
      throw error;
    }
    const old = page.items.filter((i) => typeof i.doc.createdAt === "number" && i.doc.createdAt < cutoff);
    for (const item of old) await store.delete(NOTES, item.id);
    removed += old.length;
    const reachedYoung = page.items.some((i) => typeof i.doc.createdAt === "number" && i.doc.createdAt >= cutoff);
    if (reachedYoung || page.nextCursor === null) return removed;
    cursor = page.nextCursor;
  }
}
