# Install

One binary serves MCP over stdio, which is the transport every client
supports. Install it, then add it to the client.

```bash
npm install -g @abubakarsiddiik/portolan
portolan init ./my-site
```

`init` creates the workspace and installs `skills/portolan-map/SKILL.md` and
`skills/portolan/SKILL.md` for a coding agent. Build a map before wiring the
client:

```bash
portolan map build --maps ./my-site/maps --site my-site \
  --url http://localhost:3000 --start "npm run dev" --verify --publish
```

`portolan mcp` speaks MCP on stdin/stdout and prints nothing else, so a client
can spawn it directly. It reads:

| Variable | Default | Meaning |
|---|---|---|
| `MAPS_DIR` | `maps` | Directory of `maps/<site>/v<n>.json`. |
| `DATABASE_PATH` | `portolan.db` | Session and audit database. |
| `TRACES_DIR` | `traces` | Recorded fallback and explore traces (JSONL + HAR). |
| `PORTOLAN_STORAGE_STATE` | unset | Playwright storage state for pages behind auth, from `portolan auth login`. |

Set these to absolute paths in a client config: a client spawns the server from
its own working directory, not yours. Add `TRACES_DIR` to every snippet below,
and `PORTOLAN_STORAGE_STATE` only when the app is behind auth.

The CLI is published as `@abubakarsiddiik/portolan`. If you do not want a global
install, use `npx @abubakarsiddiik/portolan` or the absolute path to `dist/bin.js`
in a source checkout.

## Claude Code

```bash
claude mcp add portolan -- portolan mcp
```

Or write `~/.claude.json`:

```json
{
  "mcpServers": {
    "portolan": {
      "command": "portolan",
      "args": ["mcp"],
      "env": {
        "MAPS_DIR": "/absolute/path/to/maps",
        "DATABASE_PATH": "/absolute/path/to/portolan.db",
        "TRACES_DIR": "/absolute/path/to/traces"
      }
    }
  }
}
```

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS, or `~/.config/Claude/claude_desktop_config.json` on Linux:

```json
{
  "mcpServers": {
    "portolan": {
      "command": "portolan",
      "args": ["mcp"],
      "env": {
        "MAPS_DIR": "/absolute/path/to/maps",
        "DATABASE_PATH": "/absolute/path/to/portolan.db",
        "TRACES_DIR": "/absolute/path/to/traces"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

## Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.portolan]
command = "portolan"
args = ["mcp"]
env = { MAPS_DIR = "/absolute/path/to/maps", DATABASE_PATH = "/absolute/path/to/portolan.db", TRACES_DIR = "/absolute/path/to/traces" }
```

## Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "portolan": {
      "command": "portolan",
      "args": ["mcp"],
      "env": {
        "MAPS_DIR": "/absolute/path/to/maps",
        "DATABASE_PATH": "/absolute/path/to/portolan.db",
        "TRACES_DIR": "/absolute/path/to/traces"
      }
    }
  }
}
```

## Gemini CLI

Edit `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "portolan": {
      "command": "portolan",
      "args": ["mcp"],
      "env": {
        "MAPS_DIR": "/absolute/path/to/maps",
        "DATABASE_PATH": "/absolute/path/to/portolan.db",
        "TRACES_DIR": "/absolute/path/to/traces"
      },
      "timeout": 30000
    }
  }
}
```

## VS Code

VS Code uses `servers` and a `type`, not `mcpServers`. Add
`.vscode/mcp.json`:

```json
{
  "servers": {
    "portolan": {
      "type": "stdio",
      "command": "portolan",
      "args": ["mcp"],
      "env": {
        "MAPS_DIR": "/absolute/path/to/maps",
        "DATABASE_PATH": "/absolute/path/to/portolan.db",
        "TRACES_DIR": "/absolute/path/to/traces"
      }
    }
  }
}
```

## Check the install

```bash
portolan doctor
```

`doctor` reports whether a client config mentions `portolan`, along with the
browser, config file, and provider variables. It does not change any file.

## HTTP instead of stdio

`portolan serve` starts the same tools over streamable HTTP at
`http://127.0.0.1:4200/mcp`. A client that supports HTTP can use that URL and
skip the stdio config; the CLI commands and the server share the map store.

## Honest limits

- **`call` needs a browser.** The MCP server executes a named op through the
  cheapest verified tier, which launches Chromium on first use. Without Chrome
  (or `CHROME_PATH`), `call` returns `op_broken`.
- **The snippets were validated, not run in each client.** The stdio command
  they invoke is covered by a test; the client-side config files were checked
  for shape, not exercised in Claude, Codex, Cursor, Gemini, or VS Code here.
- **Global install is assumed.** Project-local installs need `npx` or an
  absolute path in `command`.
- **Windows needs `command: "npx.cmd"`** (or the `.cmd` shim) rather than
  `npx`.
