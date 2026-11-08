# Client conformance

Run the same MCP conformance prompt in three clients:

```sh
pnpm --filter @portolan/bench conformance
```

The prompt asks the client to call `list_sites`, `open_site("store")`, and
`call("search", {"query":"tee"})`, then return:

```json
{ "sites": 3, "op": "search", "error": "op_broken" }
```

`op_broken` is expected: the stdio server uses the not-ready executor, so the
suite checks the MCP surface, not op execution.

The script writes `bench/results/conformance.json` and `conformance.md`.

## Result

| Client | Status | Detail |
|---|---|---|
| Claude Code | pass | sites=3, op=search, error=op_broken |
| Codex CLI | fail | 402 Payment Required (deactivated workspace) |
| Gemini CLI | pass | sites=3, op=search, error=op_broken |

## Notes

- **The suite is not in CI.** It uses the installed clients and their auth.
- **Codex's failure is an account failure**, not a Portolan failure: the CLI
  reaches its backend and gets 402. The MCP config is passed through `-c`.
- **Gemini's MCP server is added at project scope** in a temp directory, so the
  user's global settings are untouched.
- **Claude Code uses `--mcp-config` and `--strict-mcp-config`**, so only the
  Portolan server is loaded for the run.
- **The prompt is the same in all three clients.** A pass means the client
  listed the tools, called three of them, and returned the marker.
