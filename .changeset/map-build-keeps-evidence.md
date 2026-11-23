---
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

`map build` keeps what it learned:
- `--traces-dir` is read alongside `--url`.
- A traces-only build, or a crawl that never reached a page, no longer marks that page's capabilities `stale`. A trace op that covers a missing capability now marks it mapped.
- When nothing verifies, `draft.json` and `tasks.json` are written first so the `did not verify` reasons survive.
