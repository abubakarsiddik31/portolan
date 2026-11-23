---
"@abubakarsiddiik/compiler": patch
"@abubakarsiddiik/portolan": patch
---

Verification is faster. Identical param sets run once and an op with no required params needs one run. `map build --verify` runs reads side by side (`--concurrency`, default 4) while writes stay serial, and skips ops already verified against the same app build (`--app-version`, or a hash of the served HTML; `--reverify` to force). A `map update` that finds nothing new now says so instead of failing with "nothing verified".
