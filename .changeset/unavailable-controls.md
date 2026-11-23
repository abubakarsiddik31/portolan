---
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

A control that is disabled everywhere the crawl saw it is recorded as `unavailable` with a precondition, not `missing`. `map coverage` lists these separately, and `--require-complete` ignores them unless `--strict` is passed.
