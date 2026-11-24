---
"@abubakarsiddiik/protocol": minor
"@abubakarsiddiik/substrate": minor
"@abubakarsiddiik/runtime": minor
"@abubakarsiddiik/compiler": minor
---

An `http` op can now authenticate the way the site's own frontend does. The impl takes an optional `auth` that points at where the page keeps its token (`localStorage`, `sessionStorage` or a cookie, with an optional JSON path), so a write to an API on another origin sends `Authorization: Bearer ...` instead of failing with 401. The map stores the location, never the token, and the op fails with `auth_missing` when the token is gone. `map build` records the location from the requests it captures.
