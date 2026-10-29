import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_NAME } from "./index.js";
import { VERSION } from "./version.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: VERSION });
  server.registerTool(
    "ping",
    {
      description: "Check that the server runs. Returns the package version.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true, version: VERSION }) }] }),
  );
  return server;
}

export async function startMcp(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}
