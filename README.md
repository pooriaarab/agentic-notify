# agentic-notify

[![ci](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/pooriaarab/agentic-notify/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Notifications for humans and agents: in-app inbox, email and webhook delivery, with a CLI, API, MCP server and SDK.

**Status: 0.0.0, scaffold only.** The package builds and ships a health endpoint, a version command and a `ping` MCP tool. The notification core lands in the next pull requests.

## Install

```sh
npm install agentic-notify
```

## Quick start

```sh
npx agentic-notify --version
npx agentic-notify mcp
```

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
