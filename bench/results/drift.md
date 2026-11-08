# Drift run — v1 to v2 mid-run

Frozen commit: `98d8af4cd800f7720da76ab7ea6acf3b933fab03`
Model: `scripted`

| Op | v1 | after switch | after repair | tier |
|---|---|---|---|---|
| library.search | true | false | true | url |
| support.login | true | false | true | ui |
| support.create | true | false | true | http |

- **Repair rate:** 100% (3/3)
- **Duplicate writes:** 0
- **Drift-day success:** 100%

The support create write is the only write in this run. Each verification
uses a fresh session; no idempotency key is retried, so no duplicate write
is possible in this run.
