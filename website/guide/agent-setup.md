# Set up with your agent

Portolan is agent-first. The fastest path is to paste one prompt into your
coding agent and let it install the CLI, create a workspace, and wire the MCP
server.

Works with OpenCode, Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini
CLI, and VS Code.

## Copy this prompt

```text
You are setting up Portolan in this project, building a complete map of the app, keeping that map in sync, and then using it to drive the app through typed operations.

Building and syncing the map are the goal, not an optional follow-up. Do not stop after installing the CLI or calling one operation.

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
4. Ask me for the site name. Then run: portolan init --site <site>. This installs ./.portolan/skills/portolan-map/SKILL.md (how to build and keep the map complete) and ./.portolan/skills/portolan/SKILL.md (how to use it).
5. Read ./.portolan/skills/portolan-map/SKILL.md and follow it until the map is complete and in sync. Do not ask me to write JSON.
   - Ask me only for the app URL (or read baseUrl from .portolan/config.json) and the dev-server command, if they are not obvious.
   - Build from the live app: portolan map build --maps ./.portolan/maps --site <site> --url <url> --verify --publish [--start "<dev command>"]
   - For pages behind auth, run portolan auth login --url <sign-in page> --out ./.portolan/state/auth.json, add --storage-state ./.portolan/state/auth.json to every map command, and use the signed-in URL (e.g. /dashboard) as --url.
   - Inventory the app from BOTH the repository and the live app. Read routes, API handlers, forms, buttons, menus, and existing tests. If you have no repository access, browse the app itself and treat every page, link, form, and button you find as a capability.
   - You may use your own browser tool for reconnaissance. That does not record a Portolan trace. When a capability must become an op, record one run through Portolan's MCP browser tools: open_url(url, intent) or open_site(site) -> fallback_begin -> view/act/read -> fallback_done. Then rebuild with --traces-dir. A run in your own browser tool cannot become an op.
   - Add capabilities the crawl cannot see: portolan map capability add --maps ./.portolan/maps --site <site> --page <page> --kind button --name "<label>" --source code. Omit --source for capabilities you found by browsing.
   - Read the gaps: portolan map coverage --maps ./.portolan/maps --site <site> --json
   - For every missing or stale capability, either record one Portolan run as above and rebuild, or exclude it with a reason:
     portolan map capability set --maps ./.portolan/maps --site <site> --id <id> --status excluded --reason "<why>"
   - Repeat until this passes: portolan map build --maps ./.portolan/maps --site <site> --url <url> --require-complete --verify --publish
   - Keep the map in sync after every app change: portolan map update --maps ./.portolan/maps --site <site> --url <url> --verify --publish, then rebuild from traces for anything the crawl cannot see and re-check coverage.
   - Commit ./.portolan/maps/<site>/capabilities.json, draft.json, tasks.json, and v*.json with the app.
   - Only ask me to help when discovery finds nothing to start from or a capability needs a decision only I can make.
   - Use the demo store only if I ask to try Portolan without my app.
6. Configure my MCP client for this harness to spawn:
   command: portolan
   args: ["mcp"]
   env:
     MAPS_DIR: <absolute path to ./.portolan/maps>
     DATABASE_PATH: <absolute path to ./.portolan/state/portolan.db>
     TRACES_DIR: <absolute path to ./.portolan/state/traces>
     PORTOLAN_STORAGE_STATE: <absolute path to ./.portolan/state/auth.json>   # only for authenticated apps
   Detect my harness (OpenCode, Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code) and use its config format. If you cannot safely edit the config, print the exact file path and snippet.
7. Tell me to restart or reload this session so the Portolan MCP tools load.

Use once the tools and a map are available
8. Call open_site with the site name. Read the returned map and use call for named operations. Never invent operation names or parameters.
9. Use view, act, and read only when no operation fits, then close the fallback scope with fallback_done. If a site has no map, call open_url with a URL and one intent first; that records a trace you can build a map from.
10. Put an idempotency key on every write. Ask me before any irreversible operation. If a call returns unknown_outcome, do not retry; inspect the outcome check and report.
11. If an operation returns needs_confirmation, ask me before re-calling it with confirm: true.
12. After each task, summarize the operations called, the results, and any typed errors.
```

## What it does

The agent will:

1. Read the linked guide and reference pages before changing the project.
2. Install `@abubakarsiddiik/portolan` and check your browser.
3. Create a Portolan workspace with `portolan init`; this also installs the
   `portolan-map` and `portolan` skills into the workspace.
4. Build a complete map from the repository and the live app, including pages
   behind auth, and keep it in sync with `portolan map update` when the app
   changes.
5. Work `.portolan/maps/<site>/capabilities.json` until every capability is `mapped` or
   explicitly `excluded`. `--require-complete` is the gate. The agent may use
   its own browser for reconnaissance, but only Portolan MCP browser runs
   become traces that compile into ops.
6. Add the `portolan mcp` server to your client config with absolute `MAPS_DIR`,
   `DATABASE_PATH`, `TRACES_DIR`, and (for authenticated apps)
   `PORTOLAN_STORAGE_STATE`.
7. Ask you to restart the session so the tools load.
8. Use `open_site`, `call`, `view`, `act`, and `read` for the actual work.

The prompt tells the agent to ask before destructive or irreversible operations.
It never retries a write with an unknown outcome, and it does not claim a map is
complete while the capability ledger has gaps.

## Coverage is part of setup

A map is not "done" when the first crawl succeeds. The agent must:

```bash
portolan map coverage --site <site> --maps ./.portolan/maps --json
```

For every `missing` or `stale` entry, it records a run through Portolan's
browser tools or excludes the capability with a reason, then reruns the build
with `--require-complete`. Its own browser is fine for reconnaissance, but a
run in a separate browser tool is not recorded by Portolan and cannot become an
op. Building and syncing are part of setup, not follow-up work.

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
