---
"@abubakarsiddiik/protocol": patch
"@abubakarsiddiik/compiler": patch
"@abubakarsiddiik/sources": patch
---

A recorded `ui` step whose control name carries data (`Active 1`, `Delete a@x.com`) is located by a `name_re` pattern instead of the recorded text, so the op keeps working when the count or the row changes.
