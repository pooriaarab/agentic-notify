import type { Store } from "agentic-identity";
import { notificationSchema, preferencesSchema, recipientKey, type Notification, type Preferences, type Recipient } from "./types.js";

export const NOTES = "notifications";
export const PREFS = "preferences";

export interface RecipientExport {
  recipient: Recipient;
  preferences: Preferences | null;
  notifications: Notification[];
}

// One transaction per batch keeps each round trip bounded. Missing ids are ignored.
const DELETE_BATCH = 100;

async function deleteAll(store: Store, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH);
    await store.transaction(async (tx) => {
      for (const id of batch) await tx.delete(NOTES, id);
    });
  }
}

async function* notificationDocs(store: Store, recipient: Recipient, ordered = true) {
  let cursor: string | undefined;
  do {
    const page = await store.query(NOTES, {
      where: { recipientKey: recipientKey(recipient) },
      // Erase needs no order. Paging by id keeps it working when a doc has a bad createdAt.
      ...(ordered ? { orderBy: { field: "createdAt", direction: "asc" as const } } : {}),
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
  // Page by id so a doc with a bad createdAt cannot block the export, then sort here.
  for await (const item of notificationDocs(store, recipient, false)) {
    const { recipientKey: _drop, ...rest } = item.data;
    notifications.push(notificationSchema.parse(rest));
  }
  notifications.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
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
  for (let pass = 0; ; pass++) {
    // A broken adapter whose delete does nothing would loop forever. Fail instead.
    if (pass >= 20) throw new Error("erase did not finish: deletes had no effect");
    const ids: string[] = [];
    for await (const item of notificationDocs(store, recipient, false)) ids.push(item.id);
    if (ids.length === 0) break;
    await deleteAll(store, ids);
    removed += ids.length;
  }
  await store.delete(PREFS, recipientKey(recipient));
  return removed;
}

/**
 * Delete notifications created before `cutoff`, for every recipient. Returns the count.
 * A doc whose createdAt is not a number is left alone: retention does not guess.
 * If bad docs fill a whole page and block the sweep, it throws instead of reporting success.
 */
export async function sweepBefore(store: Store, cutoff: number): Promise<number> {
  if (!Number.isFinite(cutoff)) throw new RangeError("cutoff must be a finite number");
  const limit = 200;
  let removed = 0;
  const gone = new Set<string>();
  for (;;) {
    // Oldest first. Each pass starts again at the front, so no cursor ever sits on a mixed-type field.
    const page = await store.query(NOTES, { orderBy: { field: "createdAt", direction: "asc" }, limit });
    const old = page.items.filter((i) => typeof i.data.createdAt === "number" && i.data.createdAt < cutoff);
    // A row we already deleted that comes back means deletes have no effect. Fail, do not loop.
    if (old.some((i) => gone.has(i.id))) throw new Error("retention sweep did not finish: deletes had no effect");
    await deleteAll(store, old.map((i) => i.id));
    for (const item of old) gone.add(item.id);
    removed += old.length;
    if (old.length > 0) continue;
    if (page.items.length < limit || page.items.some((i) => typeof i.data.createdAt === "number")) return removed;
    throw new Error("retention sweep blocked: a full page of notifications has no usable createdAt");
  }
}
