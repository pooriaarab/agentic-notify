import { createApp, type AppOptions } from "./api.js";
import { createStoreAuth, parseRegion, type Auth, type Store } from "agentic-identity";
import { createD1Store, D1_SCHEMA, type D1Like } from "agentic-identity/cloudflare";
import { NOTES } from "./core/gdpr.js";
import { createNotifier } from "./core/service.js";
import { VERSION } from "./version.js";

export interface WorkerEnv {
  NOTIFY_NAME?: string;
  /** D1 binding. */
  DB?: D1Like;
  /** Data region of the store: "eu", "us" or "unknown". Default "eu". */
  NOTIFY_REGION?: string;
  /** Retention window in days. Unset keeps notifications. */
  NOTIFY_RETENTION_DAYS?: string;
}

export interface WorkerConfig {
  /**
   * Build the `Auth` port. Default: `createStoreAuth` over the same store, so keys that
   * agentic-identity issues into the database work here. Each route checks a scope.
   */
  auth?(env: WorkerEnv, store: Store): Auth;
  authorizeSend?: AppOptions["authorizeSend"];
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** True when a 0.1.0 table still holds rows. Those rows would be out of reach of erase, export and retention. */
async function hasLegacyRows(db: D1Like): Promise<boolean> {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notify_docs'").bind().first();
  if (!table) return false;
  return (await db.prepare("SELECT 1 AS found FROM notify_docs LIMIT 1").bind().first()) !== null;
}

/** Compose the Worker. Bring your own identity system through `auth`. */
export function createWorker(config: WorkerConfig) {
  const apps = new WeakMap<object, Promise<ReturnType<typeof createApp> | null>>();

  async function buildNotifier(env: WorkerEnv) {
    if (!env.DB) return null;
    // Fail closed: refuse to run while old rows sit unreachable. See CHANGELOG for the copy statement.
    if (await hasLegacyRows(env.DB)) throw new Error("notify_docs holds rows that were not copied to store_docs");
    await env.DB.prepare(D1_SCHEMA).bind().run();
    const days = env.NOTIFY_RETENTION_DAYS === undefined ? undefined : Number(env.NOTIFY_RETENTION_DAYS);
    const store = createD1Store(env.DB, { region: parseRegion(env.NOTIFY_REGION ?? "eu") });
    // One read now, so a bad region or an unreachable database refuses every call as not configured.
    await store.query(NOTES, { limit: 1 });
    const notifier = createNotifier({
      store,
      retentionMs: days === undefined ? undefined : days * 86_400_000,
    });
    return { notifier, store };
  }

  async function build(env: WorkerEnv) {
    const built = await buildNotifier(env);
    if (!built) return null;
    const auth = config.auth ? config.auth(env, built.store) : createStoreAuth(built.store);
    return createApp({ notifier: built.notifier, auth, authorizeSend: config.authorizeSend });
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
      // Fail closed: with no database, the API refuses every call. Without a valid key, every route is 401.
      if (!app) return json({ error: "not_configured" }, 503);
      return app.fetch(request);
    },
    /** Delete notifications past the retention window. Wire to a cron trigger. */
    async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
      await (await buildNotifier(env))?.notifier.sweep();
    },
  };
}

export default createWorker({});
