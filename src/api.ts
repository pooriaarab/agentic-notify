import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError, z } from "zod";
import { principalSchema, type Principal, type PrincipalResolver } from "./auth.js";
import { NotFoundError, type Notifier } from "./core/service.js";
import { preferencesSchema, resourceRefSchema, typeNameSchema, recipientSchema, type Recipient } from "./core/types.js";
import type { createDispatcher } from "./delivery/dispatch.js";

export interface AppOptions {
  notifier: Notifier;
  /** When set, sends also go to webhook and email channels. */
  dispatcher?: ReturnType<typeof createDispatcher>;
  resolvePrincipal: PrincipalResolver;
  /** May this principal send to this recipient? Default: only principals with `canSend: true`. */
  authorizeSend?: (principal: Principal, recipient: Recipient) => Promise<boolean> | boolean;
}

const sendBody = z
  .object({ recipient: recipientSchema, type: typeNameSchema, resource: resourceRefSchema, body: z.string().max(2000) })
  .strict();
const num = z.coerce.number().int().nonnegative();

export function createApp(options: AppOptions) {
  const { notifier } = options;
  const authorizeSend = options.authorizeSend ?? ((p: Principal) => p.canSend === true);
  const app = new Hono<{ Variables: { principal: Principal; me: Recipient } }>();

  app.get("/health", (c) => c.json({ ok: true }));

  const api = new Hono<{ Variables: { principal: Principal; me: Recipient } }>();
  api.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) }));
  api.use("*", async (c, next) => {
    const raw = await options.resolvePrincipal(c.req.raw);
    const parsed = principalSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "unauthorized" }, 401);
    c.set("principal", parsed.data);
    c.set("me", { kind: parsed.data.kind, id: parsed.data.id });
    await next();
  });

  async function json(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      throw new ZodError([{ code: "custom", path: [], message: "body must be JSON" }]);
    }
  }

  api.get("/notifications", async (c) => {
    const q = c.req.query();
    const limit = q.limit === undefined ? undefined : z.coerce.number().int().min(1).parse(q.limit);
    try {
      return c.json(await notifier.list(c.var.me, { unreadOnly: q.unread === "1" || q.unread === "true", limit, cursor: q.cursor }));
    } catch (error) {
      // The store throws RangeError for a cursor it cannot read. That is caller input.
      if (error instanceof RangeError) throw new ZodError([{ code: "custom", path: ["cursor"], message: "bad cursor" }]);
      throw error;
    }
  });
  api.post("/notifications", async (c) => {
    const input = sendBody.parse(await json(c));
    if (!(await authorizeSend(c.var.principal, input.recipient))) return c.json({ error: "forbidden" }, 403);
    // The actor is always the caller, so a sender cannot pose as someone else.
    const full = { ...input, actor: c.var.me };
    if (options.dispatcher) return c.json(await options.dispatcher.notify(full), 201);
    // No dispatcher: only the inbox works. Say so for every other channel the recipient chose.
    const sent = await notifier.send(full);
    const deliveries = sent.channels
      .filter((channel) => channel !== "inbox")
      .map((channel) => ({ channel, ok: false, skipped: "no_channel" as const }));
    return c.json({ ...sent, deliveries }, 201);
  });
  api.post("/notifications/read-all", async (c) => c.json({ marked: await notifier.markAllRead(c.var.me) }));
  api.get("/notifications/:id", async (c) => c.json(await notifier.get(c.var.me, c.req.param("id"))));
  api.post("/notifications/:id/read", async (c) => c.json(await notifier.markRead(c.var.me, c.req.param("id"))));
  api.get("/unread-count", async (c) => c.json({ count: await notifier.unreadCount(c.var.me) }));
  api.get("/digest", async (c) => {
    const since = c.req.query("since");
    return c.json(await notifier.digest(c.var.me, since === undefined ? 0 : num.parse(since)));
  });
  api.get("/preferences", async (c) => c.json(await notifier.getPreferences(c.var.me)));
  api.put("/preferences", async (c) => c.json(await notifier.setPreferences(c.var.me, preferencesSchema.parse(await json(c)))));
  api.get("/me/export", async (c) => c.json(await notifier.exportData(c.var.me)));
  api.delete("/me", async (c) => c.json(await notifier.erase(c.var.me)));

  app.route("/api/v1", api);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    if (error instanceof NotFoundError) return c.json({ error: "not_found" }, 404);
    if (error instanceof ZodError) {
      return c.json({ error: "invalid_request", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
    }
    // Never log content or ids. The error name is enough.
    console.error("internal error", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
