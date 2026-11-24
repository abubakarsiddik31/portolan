---
"@abubakarsiddiik/server": minor
"@abubakarsiddiik/substrate": minor
"@abubakarsiddiik/portolan": minor
---

`portolan mcp --watch` lets a person watch the agent work. Chrome opens as a visible window on a live timeline at `http://127.0.0.1:4300` that lists every tool call with its arguments, result or typed error, and duration, and mirrors the agent's page as a screencast. Each session opens its own window in that Chrome, which stays open until the server exits. `--headless` keeps Chrome hidden, `--watch-port` picks the port, and `PORTOLAN_WATCH=1` turns it on from an MCP client's `env`. Typed passwords and credential-shaped text are redacted before they reach the timeline, and it answers on loopback only.
