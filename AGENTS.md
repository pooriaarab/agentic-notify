# agentic-notify agent guide

Notifications for humans and agents: in-app inbox, email and webhook delivery.

## Mental model

A notification has a recipient (a human or an agent), a type, a resource
reference and an actor. One core serves the SDK, the CLI, the MCP server
and the HTTP API, so each face returns the same shape.

## The faces

- SDK: `import { VERSION } from "agentic-notify"`.
- CLI: `npx agentic-notify --help`.
- MCP: `npx agentic-notify mcp`, then call a tool below.

## MCP tools

| Tool | Use it for |
| --- | --- |
| ping | Check that the server runs. |

More tools (list, read, mark read, prefs, send) arrive with the core.

## Rules

- Read RULES.md before you change code.
- Report failures as failures. Never show a failed call as success.
