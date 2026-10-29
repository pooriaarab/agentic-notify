import type { PrincipalContext, Scope } from "agentic-identity";
import type { Recipient } from "./core/types.js";

/** One scope per kind of call. Scopes use the identity grammar `<resource>:<action>`. */
export const SCOPES = {
  /** List, read, count, digest, read preferences, export. */
  read: "notify:read",
  /** Mark read, change preferences. */
  write: "notify:write",
  /** Erase all data held about the caller. */
  erase: "notify:admin",
  /** Notify someone else. */
  send: "notify-send:write",
} as const satisfies Record<string, Scope>;

/**
 * Whose inbox a caller owns. A person and a `user_token` act on the inbox of the person.
 * Every kind of agent owns the inbox of its own id. There is no default kind.
 */
export function recipientOf(context: PrincipalContext): Recipient {
  switch (context.kind) {
    case "human":
      return { kind: "human", id: context.principalId };
    case "user_token": {
      const root = context.chain[0];
      if (!root || root.kind !== "human") throw new RangeError("a user token needs a person at the root of its chain");
      return { kind: "human", id: root.id };
    }
    case "agent":
    case "agent_of_human":
    case "agent_of_agent":
      return { kind: "agent", id: context.principalId };
    default:
      throw new RangeError("unknown principal kind");
  }
}
