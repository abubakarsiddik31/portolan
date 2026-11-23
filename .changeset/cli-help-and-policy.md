---
"@abubakarsiddiik/portolan": patch
---

`portolan <command> --help` lists that command's flags. `init --url` seeds the site policy's `allow` list, and `map build` falls back to its `--url` host when the policy's `allow` is empty, so the first build is no longer blocked by `egress blocked ... (not_allowed)`. `map build` now shares one verification Chrome across all ops, as 0.3.2 intended.
