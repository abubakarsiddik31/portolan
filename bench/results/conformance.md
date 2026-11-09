# Client conformance

Server: `packages/cli/dist/bin.js mcp`

| Client | Status | Detail |
|---|---|---|
| claude-code | pass | sites=3, op=search, ok=true |
| codex-cli | fail | 402 Payment Required (deactivated workspace) |
| gemini-cli | pass | sites=3, op=search, ok=true |

The suite asks each client to call `list_sites`, `open_site("store")`, and
`call("search", {"query":"tee"})`, then return a JSON marker. The server is
`portolan mcp`, which launches Chromium and executes the op through the url
tier, so `ok: true` means the client reached a real result, not just the surface.
