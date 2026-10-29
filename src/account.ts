// The package's side of the account contract: a host calls `exportAccount` and `eraseAccount`
// and never reads the storage layout. The shape is provisional: it is the contract that a later
// `agentic-identity` release adds to `agentic-identity/account` as `AccountPackage`. The `AccountApp`
// of earlier releases is a different contract, and this does not fit it.
import type { PrincipalKind } from "agentic-identity";
import type { Notifier } from "./core/service.js";
import { recipientSchema, type Recipient } from "./core/types.js";

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

function roleKind(kind: unknown): Recipient["kind"] | undefined {
  switch (kind) {
    case "human":
    case "user_token":
      return "human";
    case "agent_of_human":
    case "agent_of_agent":
    case "agent":
      return "agent";
    default:
      return undefined;
  }
}

/** A person or a user token is a `human` recipient. Every agent kind is an `agent` recipient. */
function recipientOf(subject: Subject): Recipient {
  // Each known kind is named. A kind that is not listed here is refused, never guessed as an agent.
  const kind = roleKind(subject?.kind);
  const parsed = recipientSchema.safeParse({ kind, id: subject?.id });
  // The same id rule as a recipient, so a too long id gives this error and not a schema error.
  if (kind === undefined || !parsed.success || parsed.data.id.trim() === "") throw new TypeError("subject needs an id and a known kind");
  return parsed.data;
}

function check(subject: Subject, deps: NotifyAccountDeps): Recipient {
  const { notifier } = deps ?? ({} as Partial<NotifyAccountDeps>);
  if ((["exportData", "eraseWithCounts"] as const).some((name) => typeof notifier?.[name] !== "function")) {
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
    return deps.notifier.eraseWithCounts(recipient);
  },
};
