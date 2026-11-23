---
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

A layout control that sits in a landmark on three or more pages (account menu, "Back to workspace") is one capability with `pages`, and its op is valid from all of them. Data in a control's name is templated (`Active {count}`, `Delete {email}`), so filter tabs and row actions are one entry each. `--no-dedupe` keeps the per-page entries. `--strict`, `--allow-cost` and `--no-dedupe` no longer swallow the next argument.
