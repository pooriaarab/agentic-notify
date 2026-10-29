import { z } from "zod";

/** Who is calling. `kind` has no default: a missing kind is an error. */
export const principalSchema = z
  .object({
    kind: z.enum(["human", "agent"]),
    id: z.string().min(1).max(200),
    /** Allowed to send notifications to others. */
    canSend: z.boolean().optional(),
  })
  .strict();
export type Principal = z.infer<typeof principalSchema>;

/** Port: turn a request into a principal, or null for "not signed in". Plug in any identity system. */
export type PrincipalResolver = (request: Request) => Promise<Principal | null> | Principal | null;

const MIN_TOKEN_BYTES = 32;
const enc = new TextEncoder();

async function digest(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Example adapter: bearer tokens from a fixed map. Tokens are stored as SHA-256
 * digests, and each must hold at least 32 bytes. Throws on a short token.
 */
export async function createStaticTokenResolver(tokens: Record<string, Principal>): Promise<PrincipalResolver> {
  const byDigest = new Map<string, Principal>();
  for (const [token, principal] of Object.entries(tokens)) {
    if (enc.encode(token).length < MIN_TOKEN_BYTES) throw new Error(`tokens must hold at least ${MIN_TOKEN_BYTES} bytes`);
    byDigest.set(await digest(token), principalSchema.parse(principal));
  }
  if (byDigest.size === 0) throw new Error("no tokens configured");
  return async (request) => {
    const m = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
    return m ? (byDigest.get(await digest(m[1]!)) ?? null) : null;
  };
}
