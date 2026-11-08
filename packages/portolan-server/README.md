# @portolan/server

The HTTP surface. It serves sessions now; the map store, op executor, and MCP
surface land in T2.07–T2.09.

## Run

```bash
pnpm --filter @portolan/server build
DATABASE_PATH=portolan.db PORT=4200 pnpm --filter @portolan/server start
```

`DATABASE_PATH=:memory:` gives an ephemeral store.

## Routes

| Method | Path | Result |
|---|---|---|
| `GET` | `/v1/health` | `{ ok: true, result: { status: "ok" } }` |
| `POST` | `/v1/sessions` | `201 { ok: true, result: { sid, site?, profile?, created_at, last_used_at } }` |
| `GET` | `/v1/sessions/:sid` | the record, including `closed_at` after close |
| `DELETE` | `/v1/sessions/:sid` | `{ ok: true, result: { sid, closed: true } }` |

Every response, including errors, uses the protocol envelope:

```json
{ "ok": false, "error": { "code": "invalid_request", "message": "...", "details": {} } }
```

Malformed JSON and schema violations are `invalid_request` with
`details.issues`. An unknown or already-closed session is `session_not_found`.

## Notes

- The store is `better-sqlite3`; sessions survive a restart.
- `createServer` takes a store, so tests use an in-memory database and
  `app.inject()` without binding a port.
- A closed session stays readable for audit. `touch` and `close` both refuse
  it, so it cannot be used again.
