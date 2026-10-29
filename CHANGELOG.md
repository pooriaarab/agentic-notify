# Changelog

All notable changes to this package are listed here.

## Unreleased

- `Store` has a new required method, `deleteMany(collection, ids)`. Custom adapters must add it.
- `D1Like` has a new required method, `batch(statements)`. The D1 adapter uses it to delete in batches of 100.
- Erase and the retention sweep delete in bulk.

## 0.1.0

First release.

- Notification model with recipient, type, resource and actor.
- Preferences per type, with mute and digest.
- In-memory store and D1 store. Both pass one contract suite.
- Signed webhook and email delivery through a dispatcher.
- HTTP API in a Cloudflare Worker under `/api/v1`.
- SDK (`agentic-notify/sdk`), CLI and MCP server.
- Per-recipient export and erase, and a retention sweep.
- Fails closed: the Worker answers 503 without a D1 binding or `NOTIFY_TOKENS`.

Not in this release: an email provider adapter, webhook endpoint management, and a web UI.
