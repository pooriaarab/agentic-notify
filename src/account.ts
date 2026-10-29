// The package's side of the account contract: a host calls `exportAccount` and `eraseAccount`
// and never reads the storage layout. The shape is provisional: it is the contract that a later
// `agentic-identity` release adds to `agentic-identity/account` as `AccountPackage`. The `AccountApp`
// of earlier releases is a different contract, and this does not fit it.
import { PRINCIPAL_KINDS, type PrincipalKind } from "agentic-identity";
import type { Notifier } from "./core/service.js";
import type { Recipient } from "./core/types.js";

export interface NotifyAccountDeps {
  notifier: Notifier;
}

/** Who the account is for: an id and a kind. The host takes the kind from the signed-in principal. */
export interface Subject {
  id: string;
  kind: PrincipalKind;
}

type JsonRecord = Record<string, unknown>;

export interface NotifyAccount {
  id: "notify";
  /** Collections: `notifications` (every one in the subject's inbox) and `preferences` (the subject's own, one row or none). */
  exportAccount(subject: Subject, deps: NotifyAccountDeps): Promise<Record<"notifications" | "preferences", JsonRecord[]>>;
  /** Erases the subject's notifications and preferences. Counts by `notifications` and `preferences`. A repeat counts zero. */
  eraseAccount(subject: Subject, deps: NotifyAccountDeps): Promise<Record<"notifications" | "preferences", number>>;
}

// Through JSON, so the records are what a file would hold: a key with no value is dropped, not left as `undefined`.
const plain = (value: unknown): JsonRecord[] => JSON.parse(JSON.stringify(value)) as JsonRecord[];

/** A person or a user token is a `human` recipient. Every agent kind is an `agent` recipient. */
function recipientOf(subject: Subject): Recipient {
  const known = (PRINCIPAL_KINDS as readonly unknown[]).includes(subject?.kind);
  if (typeof subject?.id !== "string" || subject.id.trim() === "" || !known) {
    throw new TypeError("subject needs an id and a known kind");
  }
  return { kind: subject.kind === "human" || subject.kind === "user_token" ? "human" : "agent", id: subject.id };
}

function check(subject: Subject, deps: NotifyAccountDeps): Recipient {
  const { notifier } = deps ?? ({} as Partial<NotifyAccountDeps>);
  if ((["exportData", "erase"] as const).some((name) => typeof notifier?.[name] !== "function")) {
    throw new TypeError("notifyAccount needs deps.notifier");
  }
  return recipientOf(subject);
}

export const notifyAccount: NotifyAccount = {
  id: "notify",
  async exportAccount(subject, deps) {
    const recipient = check(subject, deps);
    const out = await deps.notifier.exportData(recipient);
    return { notifications: plain(out.notifications), preferences: plain(out.preferences ? [out.preferences] : []) };
  },
  async eraseAccount(subject, deps) {
    const recipient = check(subject, deps);
    const { notifier } = deps;
    // The export tells whether a preferences row is held: the erase itself reports only notifications.
    const had = (await notifier.exportData(recipient)).preferences !== null;
    const { notifications } = await notifier.erase(recipient);
    return { notifications, preferences: had ? 1 : 0 };
  },
};
