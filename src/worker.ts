import { createApp, type AppOptions } from "./api.js";
import { parseRegion } from "agentic-identity";
import { createD1Store, D1_SCHEMA, type D1Like } from "agentic-identity/cloudflare";
import { createStaticTokenResolver, type PrincipalResolver } from "./auth.js";
import { NOTES } from "./core/gdpr.js";
import { createNotifier } from "./core/service.js";
import { VERSION } from "./version.js";

export interface WorkerEnv {
  NOTIFY_NAME?: string;
  /** D1 binding. */
  DB?: D1Like;
  /** Secret. JSON map of bearer token (32 bytes or more) to principal. */
  NOTIFY_TOKENS?: string;
  /** Data region of the store: "eu", "us" or "unknown". Default "eu". */
  NOTIFY_REGION?: string;
  /** Retention window in days. Unset keeps notifications. */
  NOTIFY_RETENTION_DAYS?: string;
}

export interface WorkerConfig {
  /** Build the principal resolver from the environment. Null means not configured. */
  resolver(env: WorkerEnv): Promise<PrincipalResolver | null>;
  authorizeSend?: AppOptions["authorizeSend"];
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

// Indexes for the inbox list (by recipient, newest first) and the retention sweep (oldest first).
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS notify_by_recipient ON store_docs (collection, json_extract(body, '$.recipientKey'), json_extract(body, '$.createdAt'), id)`,
  `CREATE INDEX IF NOT EXISTS notify_by_created ON store_docs (collection, json_extract(body, '$.createdAt'), id)`,
];

/** Compose the Worker. Bring your own identity system through `resolver`. */
export function createWorker(config: WorkerConfig) {
  const apps = new WeakMap<object, Promise<ReturnType<typeof createApp> | null>>();

  async function buildNotifier(env: WorkerEnv) {
    if (!env.DB) return null;
    for (const sql of [D1_SCHEMA, ...INDEXES]) await env.DB.prepare(sql).bind().run();
    const days = env.NOTIFY_RETENTION_DAYS === undefined ? undefined : Number(env.NOTIFY_RETENTION_DAYS);
    const store = createD1Store(env.DB, { region: parseRegion(env.NOTIFY_REGION ?? "eu") });
    // One read now, so a bad region or an unreachable database refuses every call as not configured.
    await store.query(NOTES, { limit: 1 });
    return createNotifier({
      store,
      retentionMs: days === undefined ? undefined : days * 86_400_000,
    });
  }

  async function build(env: WorkerEnv) {
    const resolvePrincipal = await config.resolver(env);
    const notifier = resolvePrincipal ? await buildNotifier(env) : null;
    if (!resolvePrincipal || !notifier) return null;
    return createApp({ notifier, resolvePrincipal, authorizeSend: config.authorizeSend });
  }

  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      const url = new URL(request.url);
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/health") {
        return json({ ok: true, name: env.NOTIFY_NAME ?? "agentic-notify", version: VERSION });
      }
      if (!url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
      let app: Awaited<ReturnType<typeof build>>;
      try {
        let p = apps.get(env);
        if (!p) apps.set(env, (p = build(env)));
        app = await p;
      } catch {
        apps.delete(env);
        return json({ error: "not_configured" }, 503);
      }
      // Fail closed: with no database or no identity setup, the API refuses every call.
      if (!app) return json({ error: "not_configured" }, 503);
      return app.fetch(request);
    },
    /** Delete notifications past the retention window. Wire to a cron trigger. */
    async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
      await (await buildNotifier(env))?.sweep();
    },
  };
}

export default createWorker({
  async resolver(env) {
    if (!env.NOTIFY_TOKENS) return null;
    return createStaticTokenResolver(JSON.parse(env.NOTIFY_TOKENS) as never);
  },
});
