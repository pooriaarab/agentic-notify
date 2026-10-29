# agentic-notify agent guide

Notifications for humans and agents: in-app inbox, email and webhook delivery.

## Mental model

A notification has a recipient (a human or an agent), a type, a resource
reference and an actor. One core serves the SDK, the CLI, the MCP server
and the HTTP API, so each face returns the same shape.

## The faces

- SDK: `import { createClient } from "agentic-notify/sdk"`.
- CLI: `npx agentic-notify --help`.
- MCP: `npx agentic-notify mcp`, then call a tool below.

## MCP tools

Set NOTIFY_URL and NOTIFY_TOKEN. Without them only `ping` works.

| Tool | Use it for |
| --- | --- |
| ping | Check that the server runs. |
| list_notifications | List yours, newest first. |
| read_notification | Get one by id. |
| mark_read / mark_all_read | Clear unread state. |
| unread_count / digest | Count unread, or group unread by type. |
| export_data / erase_data | Export or delete all data held about you. Erase needs `confirm: true`. |
| get_preferences / set_preferences | Channels per type, mute. |
| send_notification | Notify someone. Needs the send right. |

## Rules

- Read RULES.md before you change code.
- Report failures as failures. Never show a failed call as success.
