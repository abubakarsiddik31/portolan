---
"@abubakarsiddiik/server": patch
"@abubakarsiddiik/substrate": patch
"@abubakarsiddiik/portolan": patch
"@abubakarsiddiik/qa": patch
---

Stop Chrome processes piling up and exhausting memory.

- `open_site` and `open_url` now close the browser of the session they
  replace. Before, each new site left its Chrome running until exit.
- Idle sessions' browsers are closed after `sessionTtlMs` in `portolan mcp`
  and `portolan serve`, not only their database rows.
- `portolan mcp` and the QA MCP server exit when the client closes stdin, so
  a client that quits without signalling no longer orphans Chrome.
- A launch that fails after Chrome starts now closes that Chrome.
- Chrome starts with extensions, background networking, component updates,
  sync, and audio off.
