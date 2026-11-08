# Client conformance

Server: `packages/portolan-server/dist/mcp-stdio.js`

| Client | Status | Detail |
|---|---|---|
| claude-code | pass | sites=3, op=search, error=op_broken |
| codex-cli | fail | 402 Payment Required (deactivated workspace) |
| gemini-cli | pass | sites=3, op=search, error=op_broken |

The suite asks each client to call `list_sites`, `open_site("store")`, and
`call("search", {"query":"tee"})`, then return a JSON marker. The server
uses the not-ready executor, so `search` is expected to return `op_broken`;
the conformance is the MCP surface, not the op execution.
