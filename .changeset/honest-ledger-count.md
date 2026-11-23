---
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

Count only verified ops as mapped in `capabilities.json`. A proposal that fails verification now leaves its trigger `missing` with the failure as the reason, and `--require-complete` checks that result.
