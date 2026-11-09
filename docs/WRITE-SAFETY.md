# Write safety

A read can be retried. A write cannot. The runtime treats every mutation as a
small state machine.

## Effects

- **`read`** changes nothing and is safe to retry.
- **`write`** changes the site. A retry can duplicate it.
- **`irreversible`** cannot be undone. It needs `confirm: true` and a `ui` or
  `webmcp` impl; a URL navigation or a raw HTTP request is not allowed.

## Confirmation

An irreversible op without `confirm: true` returns `needs_confirmation` and
never reaches the page. The flag is a protocol requirement: the client is
saying "I know this cannot be undone".

It is not a human approval. A prompt-injected model can pass `confirm: true`.
If a human must approve, that gate belongs in the client.

## Idempotency

A write should carry an `idempotency_key`. The key identifies one logical
write, not one attempt:

1. **Done.** A completed key returns the stored result with `replayed: true`
   and does not execute again.
2. **Pending.** A key that was started but not finished is reconciled with the
   op's `outcome_check`. `done` records the result; anything else is refused
   until it can be proven.
3. **Unknown.** A key with an unknown outcome returns `unknown_outcome`. Do
   not retry; read the outcome check.
4. **Collision.** A key reused for another site or op returns
   `invalid_params` with `idempotency_key_reused`.

The ledger is a SQLite table in the same file as sessions and the audit log,
so a key survives a restart. A record left `pending` by a dead process is
settled to `unknown` at startup: the write may have reached the site, so the
next call refuses rather than retries.

## Unknown outcome

A failure after input may have reached the server is never retried blindly.
The runtime runs `outcome_check` and classifies:

| Result | Meaning | Next |
|---|---|---|
| `done` | The write happened | Use the stored result |
| `not_done` | It provably did not | Retry is safe |
| `unknown` | It may have happened | `unknown_outcome`; do not retry |

A thrown error is treated as after-dispatch, not as a clean failure.

## Audit

Every write is recorded in SQLite: op, effect, params (redacted by key), tier,
idempotency key, before/after state, outcome, and the requests the executor
reported. `GET /v1/sessions/:sid/audit` returns them.

## What the server enforces

- Confirmation before dispatch.
- Replay, reconciliation, and the collision check.
- The write rules in the map loader: no `url` write, `http` write needs an
  `outcome_check`, irreversible is `ui`/`webmcp` only.

## What it does not

- It does not know whether the value the model chose is the right one.
- It does not stop a page-initiated navigation.
- It does not authenticate the client on the HTTP transport.

See [Security](./SECURITY.md) for the full threat model.
