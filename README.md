# agentic-notify

[![ci](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Notifications for humans and agents: in-app inbox, email and webhook delivery, with a CLI, API, MCP server and SDK.

**Status: 0.0.0, in progress.** The core works in memory: send, list, read, preferences, mute and digest, behind a Store port. Delivery channels, the Worker API, CLI and MCP tools land in the next pull requests.

## Install

```sh
npm install agentic-notify
```

## Quick start

```sh
npx agentic-notify --version
npx agentic-notify mcp
```

## SDK

```ts
import { createNotifier, MemoryStore } from "agentic-notify";

const notifier = createNotifier({ store: new MemoryStore() });
await notifier.send({
  recipient: { kind: "agent", id: "helper" },
  type: "approval_request",
  resource: { kind: "doc", id: "d1" },
  actor: { kind: "human", id: "ana" },
  body: "Please approve the edit",
});
const { items } = await notifier.list({ kind: "agent", id: "helper" });
```

Adapters pass the Store contract suite from `agentic-notify/testing`.

## Planned

- Notification model, per-recipient preferences, digest.
- Store port with memory and D1 adapters.
- Delivery channels: in-app inbox, signed webhook with retry, email port.
- SDK, HTTP API in a Worker, CLI, MCP server.
- GDPR export and erase, retention, no personal data in logs.

## Develop

```sh
npm ci
npm run ci:local
```

## License

MIT
