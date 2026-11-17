# Set up with your agent

Portolan is agent-first. The fastest path is to paste one prompt into your
coding agent and let it install the CLI, create a workspace, and wire the MCP
server.

Works with OpenCode, Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini
CLI, and VS Code.

## Copy this prompt

```text
You are setting up Portolan in this project and then using it to drive websites through typed operations.

Read these pages before you start:
- Overview: https://abubakarsiddik31.github.io/portolan/guide/what-is-portolan
- Quickstart: https://abubakarsiddik31.github.io/portolan/guide/quickstart
- Concepts: https://abubakarsiddik31.github.io/portolan/guide/concepts
- Using maps: https://abubakarsiddik31.github.io/portolan/guide/using-maps
- Write safety: https://abubakarsiddik31.github.io/portolan/guide/write-safety
- Client setup: https://abubakarsiddik31.github.io/portolan/guide/clients
- Skills: https://abubakarsiddik31.github.io/portolan/guide/skills
- Build a map: https://abubakarsiddik31.github.io/portolan/guide/compiling-maps
- MCP tools: https://abubakarsiddik31.github.io/portolan/reference/mcp-tools
- CLI: https://abubakarsiddik31.github.io/portolan/reference/cli
- Configuration: https://abubakarsiddik31.github.io/portolan/reference/configuration
- Map format: https://abubakarsiddik31.github.io/portolan/reference/map-format

Setup
1. Check Node version and Chrome/Chromium. Require Node >= 22.12. If either is missing, tell me what to install and stop.
2. Install the Portolan CLI: npm install -g @abubakarsiddiik/portolan. If global installs are blocked, use npx @abubakarsiddiik/portolan for every command.
3. Run portolan doctor and report the result.
4. Ask me for the site name. Then run: portolan init ./portolan --site <site>
5. Check ./portolan/maps/<site>/ for a map version (v*.json). If none exists, stop and tell me: "Portolan needs a map for <site> before it can run operations." Ask whether I want to provide a map, compile one from traces, or use the demo store from the quickstart.
6. Configure my MCP client for this harness to spawn:
   command: portolan
   args: ["mcp"]
   env:
     MAPS_DIR: <absolute path to ./portolan/maps>
     DATABASE_PATH: <absolute path to ./portolan/portolan.db>
   Detect my harness (OpenCode, Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code) and use its config format. If you cannot safely edit the config, print the exact file path and snippet.
7. Tell me to restart or reload this session so the Portolan MCP tools load.

Use once the tools and a map are available
8. Call open_site with the site name. Read the returned map and use call for named operations. Never invent operation names or parameters.
9. Use view, act, and read only when no operation fits, then close the fallback scope with fallback_done.
10. Put an idempotency key on every write. Ask me before any irreversible operation. If a call returns unknown_outcome, do not retry; inspect the outcome check and report.
11. If an operation returns needs_confirmation, ask me before re-calling it with confirm: true.
12. After each task, summarize the operations called, the results, and any typed errors.
```

## What it does

The agent will:

1. Read the linked guide and reference pages before changing the project.
2. Install `@abubakarsiddiik/portolan` and check your browser.
3. Create a Portolan workspace with `portolan init`.
4. Check for a map and ask how to provide one if the site has none.
5. Add the `portolan mcp` server to your client config with absolute paths.
6. Ask you to restart the session so the tools load.
7. Use `open_site`, `call`, `view`, `act`, and `read` for the actual work.

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
