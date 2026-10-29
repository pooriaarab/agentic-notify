# Changelog

All notable changes to this package are listed here.

## 0.4.0

Breaking for the Worker and for library users who set their own auth. The SDK, the CLI, the MCP server and the HTTP routes keep their shape.

- Before you deploy, follow "Migrating from `NOTIFY_TOKENS`" in the README. Until a caller has a key with the right scope, the Worker answers 401 or 403 for it.
- The Worker authenticates with `requirePrincipal` from `agentic-identity/http`. The default `Auth` is `createStoreAuth` over the D1 store. The local bearer parsing is gone.
- Each route checks one scope: `notify:read`, `notify:write`, `notify:admin` (erase) or `notify-send:write` (send). A bad key is 401. A good key without the scope is 403. A delegated agent never holds more than its person.
- Erase (`DELETE /me`) now needs `notify:admin`. Before, every token could erase its own data. Send needs `notify-send:write`, which covers no read scope.
- The Worker no longer reads `NOTIFY_TOKENS`. See "Migrating from `NOTIFY_TOKENS`" in the README.
- `createApp` takes `auth` in place of `resolvePrincipal`. `createWorker` takes `auth` in place of `resolver`. `createStaticTokenResolver` is removed. `authorizeSend` receives the principal context and runs after the scope check.
- `agentic-identity` is `^0.6.0`.

## 0.3.0

Minor. Additive. No change to the SDK, the HTTP API, the CLI or the Worker.

- The MCP server has four more tools: `unread_count`, `digest`, `export_data` and `erase_data`. The HTTP API, the SDK and the CLI already had them, so the MCP server now matches the CLI.
- `erase_data` needs `confirm: true`. It permanently deletes all data held about the caller, so the tool is marked destructive. The CLI needs `erase --yes` for the same step.
- Each MCP tool acts as the caller. The token sets the caller.
- The stdio test drives the built MCP bin against the Worker.
- The README and SKILL.md list the `ping` tool. The README says that only `ping` works without `NOTIFY_URL` and `NOTIFY_TOKEN`.

## 0.2.1

Patch. No API change.

- The MCP bin answers `--help` and `-h` with usage text and exit 0. It answers `--version` and `-V` with the version. Before this, it ignored these flags and started a stdio server, so the command hung.
- Running with no arguments still starts the MCP server.

## 0.2.0

Breaking. The package now uses the `Store` port from `agentic-identity` (`^0.4.0`) and drops its own copy.

- `Store`, `Query`, `Page`, `Doc` and `Scalar` now come from `agentic-identity`. `Store` has `region` and `transaction`. It has no `create`, `replaceIf` or `deleteMany`. Query items are `{ id, data }`, not `{ id, doc }`. A custom adapter must implement the identity port and pass its contract suite.
- `MemoryStore` is gone. Use `createMemoryStore()`.
- `D1Store` and `migrateD1` are gone. Use `createD1Store(db, { region })` and run `D1_SCHEMA` once (the Worker does this itself). Both are re-exported from `agentic-notify`.
- The D1 table is now `store_docs`, not `notify_docs`. Existing rows are not copied, and the Worker answers 503 while `notify_docs` holds rows. Before you upgrade a live database, create `store_docs` with the `D1_SCHEMA` statement, run `INSERT OR IGNORE INTO store_docs (collection, id, body, version) SELECT collection, id, doc, 1 FROM notify_docs;`, then run `DROP TABLE notify_docs;`.
- `agentic-notify/testing`: `storeContract` is gone. Use `runStoreContract` (re-exported from `agentic-identity/testing`).
- The Worker reads `NOTIFY_REGION` (default `eu`). The D1 adapter fails closed when the database does not report a serving region. Set `NOTIFY_REGION=unknown` for local runs.
- The Worker reads once at start, so a wrong region gives 503 `not_configured`. It also answers 503 while `notify_docs` holds rows: copy them first (see the D1 table note above).
- The identity D1 adapter binds JSON paths as parameters, so an expression index on `store_docs` is not used by its queries. The 0.1.0 inbox indexes are gone, and a large inbox reads the whole collection until the adapter changes.
- `D1Like` and its statement type changed to the identity shape: `first`, `all` (with `meta.served_by_region`) and `run`. A wrapper written for the old type must change.
- `list` keeps the limit of 50 by default and 200 at most. A page from the port has no `nextCursor` at the end, where the old one had `null`. `list` still returns `null`. The cursor format changed, so a cursor from 0.1.0 gives a 400. `list` refuses any cursor that is not `[createdAt, id]`.
- The adapter checks the region on reads. Writes, including write-only transactions and plain `put` or `delete`, are not checked.
- A send or mark-read that keeps conflicting throws `StoreConflictError`.
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
