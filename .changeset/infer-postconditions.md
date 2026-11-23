---
"@abubakarsiddiik/protocol": patch
"@abubakarsiddiik/runtime": patch
"@abubakarsiddiik/compiler": patch
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

`map build` proposes postconditions from what a recorded run showed (a changed path or query, a new state, a dialog that appeared), so "verified" means the effect happened, not only that the click did not throw. The `url` check gains an optional `search`, an op can set `no_post`, a `ui` op with no postcondition gets an `add_postcondition` task, and `--require-post` refuses to verify it.
