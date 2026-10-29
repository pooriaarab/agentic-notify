# agentic-notify

[![ci](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Notifications for humans and agents: in-app inbox, email and webhook delivery, with a CLI, API, MCP server and SDK.

**Status: 0.1.0, first release.** Works today: the notification model, preferences and mute, digest, a store port from agentic-identity with its memory and D1 adapters, signed webhook and email delivery through a dispatcher, an HTTP API in a Worker, an SDK, a CLI, MCP tools, per-recipient export and erase, and a retention sweep. Not done: a real email provider adapter, webhook endpoint management, and a web UI.

## Install

```sh
npm install agentic-notify
```

## Quick start

Library, with the memory store:

```ts
import { createNotifier, createMemoryStore } from "agentic-notify";

const notifier = createNotifier({ store: createMemoryStore() });
await notifier.send({
  recipient: { kind: "agent", id: "helper" },
  type: "approval_request",
  resource: { kind: "doc", id: "d1" },
  actor: { kind: "human", id: "ana" },
  body: "Please approve the edit",
});
const { items } = await notifier.list({ kind: "agent", id: "helper" });
```

Worker (D1 binding `DB`, secret `NOTIFY_TOKENS`):

```sh
# Create the database first: npx wrangler d1 create agentic-notify --location weur
# NOTIFY_TOKENS is JSON: { "<token of 32+ bytes>": { "kind": "human", "id": "ana", "canSend": true } }
npx wrangler secret put NOTIFY_TOKENS
npx wrangler deploy
```

Without a D1 binding or `NOTIFY_TOKENS`, every `/api/v1` call answers 503. Nobody gets in by default.

CLI, SDK and MCP talk to that Worker:

```sh
export NOTIFY_URL=https://notify.example.org NOTIFY_TOKEN=...
npx agentic-notify send --to human:ana --type mention --resource doc:d1 --body "Look at this"
npx agentic-notify list --unread
npx agentic-notify mcp      # tools: list_notifications, read_notification, mark_read,
                            # mark_all_read, get_preferences, set_preferences, send_notification
```

```ts
import { createClient } from "agentic-notify/sdk";
const client = createClient({ baseUrl: process.env.NOTIFY_URL!, token: process.env.NOTIFY_TOKEN! });
console.log(await client.unreadCount());
```

## HTTP API

All routes sit under `/api/v1` and need `Authorization: Bearer <token>`. `GET /health` is open.

| Route | Use |
| --- | --- |
| `GET /notifications?unread=1&limit=&cursor=` | List yours, newest first |
| `POST /notifications` | Send. Needs the send right. The caller is the actor |
| `GET /notifications/:id`, `POST /notifications/:id/read` | Read one, mark read |
| `POST /notifications/read-all`, `GET /unread-count`, `GET /digest?since=` | Bulk read state, digest |
| `GET /preferences`, `PUT /preferences` | Channels per type, mute |
| `GET /me/export`, `DELETE /me` | GDPR export and hard erase |

## Identity

Auth is a port: `PrincipalResolver` turns a request into `{ kind: "human" | "agent", id }` or null. `createStaticTokenResolver` is a small example. To use another identity system, call `createWorker({ resolver })` with your own resolver. A caller reads and changes only its own notifications.

## Privacy

- Export and erase work per recipient. `retentionMs` plus `sweep()` (or a cron trigger on the Worker, with `NOTIFY_RETENTION_DAYS`) deletes old notifications.
- Erase and sweep delete in batches of 100 inside one transaction each, so a large erase does not cost one query per row.
- The Worker reads `NOTIFY_REGION` (`eu`, `us` or `unknown`, default `eu`). The D1 adapter refuses a database that does not report a serving region in that area. For local runs without a real D1, set `NOTIFY_REGION=unknown`.
- Logs hold ids, channel names and error names only. They never hold bodies or addresses.
- Erase removes a recipient's own notifications and preferences. Notifications that name the person only as actor stay with their recipients.

## Limits

- The default Worker serves the inbox. To fan out to webhook and email, compose `createApp` with `createDispatcher` in your own Worker.
- Webhook endpoints and email addresses come from resolvers you provide. The package stores none.
- Webhook retries run inside the request. Use a queue for heavy fan-out.

## Develop

```sh
npm ci
npm run ci:local
```

## License

MIT
