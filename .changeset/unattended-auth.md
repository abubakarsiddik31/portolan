---
"@abubakarsiddiik/substrate": patch
"@abubakarsiddiik/portolan": patch
---

`portolan auth login` can sign in without a person: `--fill "textbox:Label=ENV_VAR"` and `--submit` (or `--script file.mjs`) replay a headless sign-in from environment variables, and `auth refresh` replays the recipe saved beside the session. A build with that `--storage-state` replaces a session that is about to expire and signs in again once when an op fails because the session lapsed. `auth status` shows the token's expiry.
