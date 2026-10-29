# agentic-notify

[![ci](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Notifications for humans and agents: in-app inbox, email and webhook delivery, with a CLI, API, MCP server and SDK.

**Status: 0.5.0.** Breaking for Worker auth, see "Migrating from `NOTIFY_TOKENS`" below. Breaking for 0.1.0 code and databases, see the CHANGELOG upgrade steps. Works today: the notification model, preferences and mute, digest, a store port from agentic-identity with its memory and D1 adapters, signed webhook and email delivery through a dispatcher, an HTTP API in a Worker, an SDK, a CLI, MCP tools, per-recipient export and erase, a retention sweep, and a React bell and inbox (`agentic-notify/ui`). Not done: a real email provider adapter, webhook endpoint management, and a full-page inbox app.

## Live demo

A demo Worker runs at https://agentic-notify-demo.hello-fd1.workers.dev. `GET /health` answers 200. The `/api/v1` routes need a key, so without one they answer 401. The demo keeps its data in the EU and sweeps notifications after 7 days.

The demo page is in `ui/` and the Worker serves it at `/ui/` after `npm run deploy:demo`. Sign in with a key that holds `notify:read` and `notify:write`. Add `notify-send:write` to use the send form.

Redeploy your own copy with `wrangler.demo.jsonc` (create the D1 database with `--location weur`, put its id in the file, then add principals and keys, see Identity):

```sh
WRANGLER_SEND_METRICS=false npm run deploy:demo
```

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

Worker (D1 binding `DB`):

```sh
# Create the database first: npx wrangler d1 create agentic-notify --location weur
npx wrangler deploy
```

The Worker reads keys and principals from the same D1 database, with `agentic-identity`. Issue a key for each caller with `agentic-identity` (for example `issueCredential`, or its Worker), into this database. See Identity below.

Without a D1 binding, every `/api/v1` call answers 503. A request without a valid key answers 401, on unknown paths too. Nobody gets in by default.

CLI, SDK and MCP talk to that Worker:

```sh
export NOTIFY_URL=https://notify.example.org NOTIFY_TOKEN=...
npx agentic-notify send --to human:ana --type mention --resource doc:d1 --body "Look at this"
npx agentic-notify list --unread
npx agentic-notify mcp      # tools: ping, list_notifications, read_notification, mark_read,
                            # mark_all_read, get_preferences, set_preferences, unread_count, digest,
                            # export_data, erase_data, send_notification
```

`npx agentic-notify mcp --help` (or `-h`) prints the usage and exits 0. `npx agentic-notify mcp --version` (or `-V` or `-v`) prints the version and exits 0. Neither starts the server.

The MCP server needs `NOTIFY_URL` and `NOTIFY_TOKEN`. Without them only `ping` works. `erase_data` needs `confirm: true` and a key with `notify:admin`. `send_notification` needs `notify-send:write`. A tool that lacks its scope reports 403.

```ts
import { createClient } from "agentic-notify/sdk";
const client = createClient({ baseUrl: process.env.NOTIFY_URL!, token: process.env.NOTIFY_TOKEN! });
console.log(await client.unreadCount());
```

## HTTP API

All routes sit under `/api/v1` and need `Authorization: Bearer <key>`. `GET /health` is open. A missing or bad key answers 401. A good key without the scope of the route answers 403. Each route needs one scope:

| Scope | Routes |
| --- | --- |
| `notify:read` | `GET /notifications`, `GET /notifications/:id`, `GET /unread-count`, `GET /digest`, `GET /preferences`, `GET /me/export` |
| `notify:write` | `POST /notifications/:id/read`, `POST /notifications/read-all`, `PUT /preferences` |
| `notify-send:write` | `POST /notifications` |
| `notify:admin` | `DELETE /me` |

A scope with a higher action covers the lower ones, so `notify:admin` covers `notify:write` and `notify:read`. `*:admin` covers all. `notify-send` is a separate resource, so a key that can only send cannot read.

| Route | Use |
| --- | --- |
| `GET /notifications?unread=1&limit=&cursor=` | List yours, newest first |
| `POST /notifications` | Send. Needs the send right. The caller is the actor |
| `GET /notifications/:id`, `POST /notifications/:id/read` | Read one, mark read |
| `POST /notifications/read-all`, `GET /unread-count`, `GET /digest?since=` | Bulk read state, digest |
| `GET /preferences`, `PUT /preferences` | Channels per type, mute |
| `GET /me/export`, `DELETE /me` | GDPR export and hard erase |

## Identity

The Worker authenticates with `agentic-identity`. `requirePrincipal` from `agentic-identity/http` reads the credential, and the `Auth` port checks that it is not expired or revoked. The default `Auth` takes a bearer key, and also a `session` cookie that `agentic-identity` sets. A write with a cookie is refused, because no origin is allowed here. Pass your own `Auth` to accept bearer keys only. The default `Auth` is `createStoreAuth` over the same D1 store. Each route checks one scope (see HTTP API). A delegated agent holds only the scopes that its person also holds.

A person, and a `user_token` of that person, use the inbox of the person. An agent (`agent`, `agent_of_human` or `agent_of_agent`) uses the inbox of its own id. A caller reads and changes only its own notifications.

To use another identity system, call `createWorker({ auth: (env, store) => myAuth })`, where `auth` builds your own `Auth` from the Worker env and the store. Import `createWorker` from `agentic-notify/worker`.

### Migrating from `NOTIFY_TOKENS`

Before 0.4.0, the Worker read a static `NOTIFY_TOKENS` secret: a map of token to `{ kind, id, canSend }`. The tokens had no scopes. The Worker no longer reads it. Steps:

1. Delete the `NOTIFY_TOKENS` secret (`npx wrangler secret delete NOTIFY_TOKENS`).
2. Make each caller a principal in the D1 database, and issue it a key with `agentic-identity`. The old `{ "kind": "human" }` becomes kind `human`, and `{ "kind": "agent" }` becomes kind `agent`.
3. Give each principal scopes. An old token could read, change and erase its own inbox. To keep that, use `notify:admin`. For less, use `notify:write` (it covers `notify:read`) or `notify:read`. For the old `canSend: true`, add `notify-send:write`. It is a separate resource, so it does not cover `notify:read`: a caller that sends and reads needs both.
4. Give the new key to the CLI, SDK and MCP server as `NOTIFY_TOKEN`.

Library users: `createWorker` takes `auth` in place of `resolver`. `authorizeSend` still works as an extra check after the scope. Its first argument is now a `PrincipalContext` (`principalId` in place of `id`, no `canSend`). Its default changed: it was "only `canSend: true`", and now every caller with `notify-send:write` may send unless you pass your own.

## Privacy

- Export and erase work per recipient. `retentionMs` plus `sweep()` (or a cron trigger on the Worker, with `NOTIFY_RETENTION_DAYS`) deletes old notifications.
- Erase and sweep delete in batches of 100 inside one transaction each, so a large erase does not cost one query per row.
- The Worker reads `NOTIFY_REGION` (`eu`, `us` or `unknown`, default `eu`). The D1 adapter refuses a database that does not report a serving region in that area. For local runs without a real D1, set `NOTIFY_REGION=unknown`.
- Logs hold ids, channel names and error names only. They never hold bodies or addresses.
- Erase removes a recipient's own notifications and preferences. Notifications that name the person only as actor stay with their recipients.

## Bell and inbox (React)

`agentic-notify/ui` is a bell button with an unread count. It opens a popover with the inbox: the list, mark read, mark all read, and an empty state. It refreshes by itself over the HTTP API, so new notifications show without a reload. React 19 is a peer dependency. The package depends on `agentic-design` for the parts and the tokens.

```tsx
import { NotificationBell } from "agentic-notify/ui";
import "agentic-design/styles.css";
import "agentic-notify/ui.css";

<NotificationBell baseUrl="https://notify.example.com" getToken={() => session.token} />;
```

- The Worker sends no CORS headers. Serve the bell from the Worker's own origin, or put the Worker behind a proxy on your app's origin. A cross-origin page cannot call it, and the popover then shows a load error.
- `getToken` runs before each request. Return the key of the signed-in person or agent. The server checks every call.
- `baseUrl` must be `https:`. Plain `http:` works for localhost only. A bad `baseUrl`, `pollMs` or `limit` throws a `TypeError`.
- When the signed-in caller changes, give the bell a new `key` (React) or call `update` (`mount` remounts it). Then one caller's list never shows under another's token.
- A call that takes over 10 seconds ends as a load error. Polling stops after a refused token until the person opens the bell or presses Try again.
- Put a bell near the left edge of the page with `align="start"`, so the popover opens to the right.
- `align` (`"start"` or `"end"`) sets which edge of the bell the popover lines up with. On a phone the popover spans the width under the bell.
- The bell name says "could not load" when a call fails, so a failure never reads as an empty inbox.
- `mount` does not change the page theme.
- `pollMs` sets the refresh interval (default 15000, 0 turns it off). The page refreshes when the tab becomes visible. `limit` sets the list size (default 20).
- A refused or failed call shows an alert in the popover. The list never shows a failed call as success.
- Notifications from an agent carry the words "Sent by an agent".
- `useNotifications(options)` gives the state and the actions without the markup. `<Inbox state={...} />` renders the list alone from that state. `headingId` is optional.
- Install `agentic-design` in your app too, so your bundler can resolve `agentic-design/styles.css`. Use one copy of it.
- Without React, `mount(element, options)` renders the bell into an element and returns `update` and `unmount`.
- It uses `agd-` classes only. Keyboard: Enter opens, Escape closes and returns focus. It passes an axe WCAG 2.2 AA scan in light and dark, and it fits a 390px screen.

## Testing

`agentic-notify/testing` helps you test a store adapter and your own code.

`runStoreContract(make)` runs the store contract suite. Call it at the top level of a vitest test
file, and install `vitest` 3 or later. The factory makes a new store for each call. A store made
without `shared` must start empty. Stores made with the same `shared` value must see the same data.
So the factory passes `options` to the store:

```ts
import { createMemoryStore } from "agentic-notify";
import { runStoreContract } from "agentic-notify/testing";

runStoreContract((options) => createMemoryStore(options));
```

`TestEmailAdapter` records each message in memory and can fail a set number of sends.

## Limits

- The default Worker serves the inbox. To fan out to webhook and email, compose `createApp` with `createDispatcher` in your own Worker.
- Webhook endpoints and email addresses come from resolvers you provide. The package stores none.
- Webhook retries run inside the request. Use a queue for heavy fan-out.

## Develop

```sh
npm ci
npm run ci:local
```

`npm test` skips the `./ui` export check until you run `npm run build`. `ci:local` builds first and also runs the browser tests (`npm run test:ui`). Install the browser once with `npx playwright install chromium`.

## License

MIT
