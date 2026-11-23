---
"@abubakarsiddiik/qa": patch
---

A case for a known bug can be marked `expect_failure: { reason, issue? }`. `qa verify` promotes it when it fails with the same code and step on every replay, and `qa run` reports it as `known_failure` (the run stays green) instead of skipping it as unverified. When it starts passing the run reports `fixed` and says to remove the marker. A different failure is still a `fail`.
