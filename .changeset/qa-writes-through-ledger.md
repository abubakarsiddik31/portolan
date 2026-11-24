---
"@abubakarsiddiik/qa": minor
---

A write op in a QA case now runs through the same guard as an MCP write. An irreversible op needs `confirm`, each write has an idempotency key in the write ledger (a step can set `idempotency_key`), and the op's `outcome_check` settles a write whose result is in doubt. `QaService` takes an optional `ledger` so QA writes and MCP writes share one.
