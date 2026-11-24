---
"@abubakarsiddiik/runtime": minor
"@abubakarsiddiik/server": minor
"@abubakarsiddiik/portolan": minor
---

`http` ops run without a browser. When a saved session exists, `call` sends the op's requests from the server with the session's cookies and the bearer token the impl's `auth` points at, so no Chrome is launched and nothing is rendered or settled. The egress policy still applies, and a fresh `auth login` is picked up without a restart. Chrome opens only when the request was never sent (no session, no token in the saved storage, or a blocked URL); a write the site already answered is not retried through a page.
