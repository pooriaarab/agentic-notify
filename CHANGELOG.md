# Changelog

All notable changes to this package are listed here.

## Unreleased

Breaking. The package now uses the `Store` port from `agentic-identity` (`^0.4.0`) and drops its own copy.

- `Store`, `Query`, `Page`, `Doc` and `Scalar` now come from `agentic-identity`. `Store` has `region` and `transaction`. It has no `create`, `replaceIf` or `deleteMany`. Query items are `{ id, data }`, not `{ id, doc }`. A custom adapter must implement the identity port and pass its contract suite.
- `MemoryStore` is gone. Use `createMemoryStore()`.
- `D1Store` and `migrateD1` are gone. Use `createD1Store(db, { region })` and run `D1_SCHEMA` once (the Worker does this itself). Both are re-exported from `agentic-notify`.
- The D1 table is now `store_docs`, not `notify_docs`. Existing rows are not copied. Copy them with SQL before you upgrade a live database.
- `agentic-notify/testing`: `storeContract` is gone. Use `runStoreContract` (re-exported from `agentic-identity/testing`).
- The Worker reads `NOTIFY_REGION` (default `eu`). The D1 adapter fails closed when the database does not report a serving region. Set `NOTIFY_REGION=unknown` for local runs.
- Send and mark-read run in transactions. Erase and the retention sweep delete in batches of 100.

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
