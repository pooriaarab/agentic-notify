---
name: agentic-notify
description: Notifications for humans and agents: in-app inbox, email and webhook delivery.
---

# agentic-notify

Notifications for humans and agents. Set NOTIFY_URL and NOTIFY_TOKEN first.

## Use the CLI

```sh
npx agentic-notify list --unread
npx agentic-notify read <id>
npx agentic-notify send --to human:ana --type mention --resource doc:d1 --body "text"
```

## Use the MCP server

Start the server with `npx agentic-notify mcp`. Tools: list_notifications, read_notification, mark_read, mark_all_read, get_preferences, set_preferences, send_notification.
