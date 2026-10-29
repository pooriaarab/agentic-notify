import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiError, type Client } from "./sdk.js";
import { preferencesSchema, recipientSchema, resourceRefSchema, typeNameSchema } from "./core/types.js";
import { PACKAGE_NAME } from "./index.js";
import { VERSION } from "./version.js";

type Result = { content: { type: "text"; text: string }[]; isError?: true };

async function wrap(fn: () => Promise<unknown>): Promise<Result> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (error) {
    if (error instanceof ApiError) {
      return { content: [{ type: "text", text: JSON.stringify({ error: error.code, status: error.status }) }], isError: true };
    }
    throw error;
  }
}

/** Without a client, only `ping` works and the other tools report that setup is missing. */
export function createMcpServer(client?: Client): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: VERSION });
  const need = (fn: (c: Client) => Promise<unknown>) => () =>
    wrap(async () => {
      if (!client) throw new ApiError(0, "not_configured");
      return fn(client);
    });
  const read = { readOnlyHint: true };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool("ping", { description: "Check that the server runs. Returns the package version.", inputSchema: {}, annotations: read },
    async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true, version: VERSION }) }] }));
  server.registerTool("list_notifications", {
    description: "List your notifications, newest first.",
    inputSchema: { unreadOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() },
    annotations: read,
  }, (a) => need((c) => c.list(a))());
  server.registerTool("read_notification", { description: "Get one notification by id.", inputSchema: { id: z.string() }, annotations: read },
    ({ id }) => need((c) => c.get(id))());
  server.registerTool("mark_read", { description: "Mark one notification as read.", inputSchema: { id: z.string() }, annotations: write },
    ({ id }) => need((c) => c.markRead(id))());
  server.registerTool("mark_all_read", { description: "Mark all your notifications as read.", inputSchema: {}, annotations: write },
    need((c) => c.markAllRead()));
  server.registerTool("get_preferences", { description: "Read your notification preferences.", inputSchema: {}, annotations: read },
    need((c) => c.getPreferences()));
  server.registerTool("set_preferences", {
    description: "Replace your notification preferences: channels per type, mute, muted types.",
    inputSchema: preferencesSchema.shape,
    annotations: write,
  }, (a) => need((c) => c.setPreferences(a))());
  server.registerTool("send_notification", {
    description: "Send a notification. You must hold the send right. You are the actor.",
    inputSchema: { recipient: recipientSchema, type: typeNameSchema, resource: resourceRefSchema, body: z.string().max(2000) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (a) => need((c) => c.send(a))());
  return server;
}

export async function startMcp(client?: Client): Promise<void> {
  await createMcpServer(client).connect(new StdioServerTransport());
}

