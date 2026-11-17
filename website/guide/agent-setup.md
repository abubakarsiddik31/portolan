# Set up with your agent

Portolan is agent-first. The fastest path is to paste one prompt into your
coding agent and let it install the CLI, create a workspace, and wire the MCP
server.

Works with Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, and
VS Code.

## Copy this prompt

```text
You are setting up Portolan in this workspace, then using it.

Setup
1. Check Node version and Chrome/Chromium. Require Node >= 22.12. If either is missing, tell me what to install and stop.
2. Install the Portolan CLI: npm install -g @abubakarsiddiik/portolan. If global installs are blocked, use npx @abubakarsiddiik/portolan for every command instead.
3. Run portolan doctor and report the result.
4. Ask me for the site name. Then run: portolan init ./portolan --site <site>
5. Configure my MCP client for this harness to spawn:
   command: portolan
   args: ["mcp"]
   env:
     MAPS_DIR: <absolute path to ./portolan/maps>
     DATABASE_PATH: <absolute path to ./portolan/portolan.db>
   Detect the harness (Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code) and use its config format. If you cannot safely edit the config, print the exact snippet and file path.
6. Tell me to restart this session so the Portolan tools load.

Use
7. After the restart, call open_site with the site name. Read the returned map and use call for named operations. Never invent operation names or parameters.
8. Use view, act, and read only when no operation fits, and close the fallback scope with fallback_done.
9. Include an idempotency key on writes. Ask me before any irreversible operation. If a call returns unknown_outcome, do not retry; inspect the outcome check and report.
10. After each task, summarize the operations called, results, and any errors.
```

## What it does

The agent will:

1. Install `@abubakarsiddiik/portolan` and check your browser.
2. Create a Portolan workspace with `portolan init`.
3. Add the `portolan mcp` server to your client config with absolute paths.
4. Ask you to restart the session so the tools load.
5. Use `open_site`, `call`, `view`, `act`, and `read` for the actual work.

The prompt tells the agent to ask before writing files and before irreversible
operations. It never retries a write with an unknown outcome.

## After setup

Restart your session, then try:

```text
Call open_site for the site. Show me the operations, then search for "linen shirt".
```

The agent should call `open_site`, read the map, and use `call` with the
`search` operation.

## Prefer to do it yourself?

- [Quickstart](/guide/quickstart) — install and run the demo.
- [Connect your agent](/guide/clients) — a snippet for every client.
- [Using maps](/guide/using-maps) — the call loop an agent runs.
