---
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

Staleness is scoped to what a run observed. Capabilities carry `last_seen` and `last_verified`; a control gone from a page the crawl reached is `removed`, and `stale` is kept for an op that used to verify and now fails. `map update --state <id>` re-crawls and re-verifies only that state, `map coverage --older-than 7d` lists what nothing has seen lately, and `discoverDom` accepts several entry points.
