---
"@abubakarsiddiik/portolan": minor
"@abubakarsiddiik/qa": minor
"@abubakarsiddiik/protocol": patch
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/compiler": patch
---

This release adds `map sync`, `map status`, `map record --gaps`, `policy allow`, `auth refresh` and unattended sign-in, and in QA `expect_failure` and waiting checks, so the CLI and QA move to a new minor version.

A path segment like `p_101`, `ord_1` or `usr_9f3a` is now an id, so `/p/p_101` and `/p/p_102` are one state and one parameterized op. Every flag the CLI reads as a boolean (`--dry-run`, `--all`, `--allow-unverified`, `--changed`, `--mcp`, `--include-quarantined` were missing) no longer swallows the next argument.
