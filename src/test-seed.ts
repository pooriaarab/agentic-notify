import { createHash } from "node:crypto";
import { D1_SCHEMA } from "agentic-identity/cloudflare";

/** One test caller: a principal and the one key that signs it in. */
export interface SeedCaller {
  token: string;
  id: string;
  kind: "human" | "agent" | "agent_of_human" | "agent_of_agent" | "user_token";
  scopes: string[];
  parentId?: string;
}

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** SQL for the identity rows that `createStoreAuth` reads: a principal and a hashed key for each caller. */
export function seedSql(callers: SeedCaller[]): string[] {
  const rows = callers.flatMap((c) => {
    const principal = { id: c.id, kind: c.kind, scopes: c.scopes, ...(c.parentId ? { parentId: c.parentId } : {}) };
    const credential = { principalId: c.id, kind: "api_key" };
    const hash = createHash("sha256").update(c.token).digest("hex");
    return [
      `INSERT OR REPLACE INTO store_docs (collection, id, body, version) VALUES ('principals', ${quote(c.id)}, ${quote(JSON.stringify(principal))}, 1)`,
      `INSERT OR REPLACE INTO store_docs (collection, id, body, version) VALUES ('credentials', '${hash}', ${quote(JSON.stringify(credential))}, 1)`,
    ];
  });
  return [D1_SCHEMA, ...rows];
}
