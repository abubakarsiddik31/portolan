# CLI

```text
portolan <command> [options]
```

## Commands

| Command | What it does |
|---|---|
| `portolan init [dir]` | Write a config, a policy, and the `maps/` and `skills/` directories. |
| `portolan mcp` | Serve MCP over stdio for a client to spawn. |
| `portolan serve` | Start the HTTP and MCP server. |
| `portolan compile <trace...>` | Compile traces into a new map version. |
| `portolan verify` | Verify a map's operations on a fresh session. |
| `portolan export-skills` | Export a `portolan-<site>` skill from a map. |
| `portolan bench [suite]` | Run a benchmark suite from the source checkout. |
| `portolan doctor` | Diagnose the browser, config, providers, and clients. |

## Common options

| Option | Meaning |
|---|---|
| `--config <path>` | Config file. Default `./portolan.config.json`. |
| `--help` | Show usage. |

Command flags beat the config file, which beats the default.

## Examples

```bash
# initialize a project
portolan init ./my-site --site store

# serve MCP over stdio (what a client spawns)
portolan mcp

# serve MCP over streamable HTTP
portolan serve --port 4200

# verify a map against a live site
portolan verify --map maps/store/v1.json --params store.params.json \
  --base-url https://store.example

# export a skill from a map
portolan export-skills --map maps/store/v1.json --out skills
```

## Environment

The CLI reads `portolan.config.json` and these variables:

| Variable | Meaning |
|---|---|
| `PORTOLAN_CONFIG` | Config file when `--config` is absent. |
| `MAPS_DIR` | Map directory for `portolan mcp`. Default `maps`. |
| `DATABASE_PATH` | Session and audit database for `portolan mcp`. |
| `CHROME_PATH` | Chrome binary when `chrome` is unset. |
| `PORTOLAN_AUTH_TOKEN` | Bearer token for a non-loopback `serve` bind. |

See [Configuration](/reference/configuration) for every option.
