# Configuration

Portolan reads one JSON file, `portolan.config.json`. Every option has a
default, so an empty file is valid. The file is read by the `portolan` CLI;
the server and compiler libraries take typed options directly.

## Where the file is found

1. `--config <path>` on the command.
2. `PORTOLAN_CONFIG` in the environment.
3. `./portolan.config.json`.

A missing file means the defaults. A file that is not a JSON object, or an
option with the wrong type, is an error with the file path and the key.

Unknown keys are ignored, so a config written for a newer CLI still loads in an
older one.

## Options

| Key | Type | Default | Used by | Meaning |
|---|---|---|---|---|
| `site` | string | `"site"` | `init`, `compile`, `export-skills` | Site name; `init` writes `policies/<site>.json` and `maps/<site>/`. |
| `maps` | string | `"maps"` | `serve`, `init` | Directory containing `maps/<site>/v<n>.json`. |
| `skills` | string | `"skills"` | `export-skills`, `init` | Output directory for `portolan-<site>` skills. |
| `policies` | string | `"policies"` | `init` | Directory containing `<site>.json` egress policies. |
| `database` | string | `"portolan.db"` | `serve` | SQLite path. `:memory:` gives an ephemeral store. |
| `host` | string | `"127.0.0.1"` | `serve` | Listen address. |
| `port` | integer ≥ 0 | `4200` | `serve` | Listen port. `0` asks the OS for one. |
| `baseUrl` | string | unset | `compile`, `verify` | Live site origin, used when `--base-url` is not passed. |
| `chrome` | string | unset | `compile`, `verify` | Chrome binary. Unset means `CHROME_PATH`, then the usual install paths. |
| `headless` | boolean | `true` | `compile`, `verify` | Run Chromium headless. `--headed` overrides it to `false`. |
| `sessionTtlMs` | integer ≥ 1 | `1800000` (30 min) | `serve` | Idle time after which a session is closed. |
| `maxOpenSessions` | integer ≥ 1 | `100` | `serve` | A create at the cap returns `429 session_limit`. |
| `cleanupIntervalMs` | integer ≥ 1 | `60000` (60 s) | `serve` | How often the expiry sweep runs. |
| `recoverSessions` | boolean | `true` | `serve` | Close sessions left open by a previous process at startup. |
| `logLevel` | `debug` \| `info` \| `warn` \| `error` | `"info"` | `serve` | Structured log threshold. |

## Example

```json
{
  "site": "store",
  "maps": "maps",
  "skills": "skills",
  "policies": "policies",
  "database": "portolan.db",
  "host": "127.0.0.1",
  "port": 4200,
  "headless": true,
  "sessionTtlMs": 1800000,
  "maxOpenSessions": 100,
  "cleanupIntervalMs": 60000,
  "recoverSessions": true,
  "logLevel": "info"
}
```

`portolan init` writes this file with the defaults for the chosen site.

## Precedence

A command flag beats the config file, which beats the default. For example,
`portolan serve --port 5000` listens on 5000 even when the file says `4200`.

## Environment

These are read in addition to the config file:

| Variable | Default | Meaning |
|---|---|---|
| `PORTOLAN_CONFIG` | `./portolan.config.json` | Config file, when `--config` is absent. |
| `CHROME_PATH` | auto-detect | Chrome binary, when `chrome` is unset. |
| `PORTOLAN_INSTANCE_ID` | unset | Stable id used to reap a hard-killed predecessor's browsers. |
| `PORTOLAN_<SITE>_<KEY>` | unset | Site-scoped credential, e.g. `PORTOLAN_STORE_API_KEY`. |
| `ANTHROPIC_API_KEY` | unset | Anthropic provider for compile and repair. |
| `OPENAI_API_KEY` | unset | OpenAI provider for compile and repair. |
| `GEMINI_API_KEY` | unset | Gemini provider. |
| `OLLAMA_HOST` | unset | Local Ollama endpoint. |
| `DATABASE_PATH` | `portolan.db` | Used by `start.ts` (the bare server process), not `portolan serve`. |
| `PORT` / `HOST` | `4200` / `127.0.0.1` | Used by `start.ts`, not `portolan serve`. |

`portolan doctor` reports which provider variables are set without printing
their values.

## Not in the config file

These are programmatic options, passed to `createServer` by a host:

| Option | Default | Meaning |
|---|---|---|
| `store` | required | A `SessionStore`. The server never creates or closes it. |
| `maps` | unset | A `MapStore`; enables `GET /v1/sites/:site/health` and the MCP surface. |
| `executor` | `notReadyExecutor` | The op executor. |
| `canary` | unset | A `CanaryScheduler`, started and stopped with the server. |
| `browsers` | new registry | `BrowserRegistry` for session-owned engines. |
| `logger` | `false` | Fastify's request log. |
| `log` | unset | A structured `Logger` for lifecycle events. |

They are not config keys because they are live objects, not data: a config file
cannot name a function or a database handle.
