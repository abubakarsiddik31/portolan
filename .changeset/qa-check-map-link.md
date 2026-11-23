---
"@abubakarsiddiik/qa": patch
---

A write case's `map.op` is now checked: the map version must exist, the op must be in it with the case's `effect`, and an irreversible op's step needs `confirm: true`. It is enforced at `qa case write`, reported by `qa sync`, and a case with a wrong link is not run (it returns an `invalid_request` error). `map: { site, pending: "<why>" }` marks a write that has no op yet, and `qa sync` lists those.
