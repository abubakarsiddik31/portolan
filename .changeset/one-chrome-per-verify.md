---
"@abubakarsiddiik/substrate": patch
"@abubakarsiddiik/compiler": patch
"@abubakarsiddiik/portolan": patch
---

Verification no longer launches a Chrome per run. `verifyOp` opens one browser and an isolated context per run, and `map build` shares a single browser across every op it verifies, so a build stops spawning dozens of Chrome processes.
