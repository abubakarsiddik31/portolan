---
"@abubakarsiddiik/substrate": patch
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

Exclusion rules move into `policies/<site>.json` as categorized `rules`, matched on a control's label and/or the request its recorded run fired. Excluded capabilities carry a generated `category: reason`, a notifications bell and a trailing `?` are no longer excluded, and an op whose run fired a `cost` or `destructive` request is held back from verification unless `--allow-cost` is passed. `portolan policy allow --site x host` edits the allow list, and a build that was blocked prints the hosts to allow.
