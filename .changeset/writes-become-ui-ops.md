---
"@abubakarsiddiik/compiler": patch
---

A recorded write with no outcome check now compiles to a `ui` write candidate instead of being dropped, so `map build` can verify it with `--verify-writes`. A write segment is named after the click that made the request, not the last click on the confirmation dialog.
