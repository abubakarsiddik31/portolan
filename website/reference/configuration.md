# Configuration

Portolan reads one JSON file, `.portolan/config.json`. Every option has a
default, so an empty file is valid. The file is read by the `portolan` CLI;
the server and compiler libraries take typed options directly.

## Where the file is found

1. `--config <path>` on the command.
2. `PORTOLAN_CONFIG` (or `QA_CONFIG` for the QA runner) in the environment.
3. `./.portolan/config.json`.
4. `./portolan.config.json`, the pre-`.portolan/` layout, with a deprecation
   notice. `portolan migrate` moves it.

A missing file means the defaults. A file that is not a JSON object, or an
option with the wrong type, is an error with the file path and the key.

Unknown keys are ignored, so a config written for a newer CLI still loads in an
older one.

## Options

| Key | Type | Default | Used by | Meaning |
|---|---|---|---|---|
| `site` | string | `"site"` | `init`, `compile`, `export-skills` | Site name; `init` writes `.portolan/policies/<site>.json` and `.portolan/maps/<site>/`. |
| `maps` | string | `".portolan/maps"` | `serve`, `init` | Directory containing `maps/<site>/v<n>.json`. |
| `skills` | string | `".portolan/skills"` | `export-skills`, `init` | Output directory for `portolan-<site>` skills. |
| `policies` | string | `".portolan/policies"` | `init` | Directory containing `<site>.json` egress policies. |
| `database` | string | `".portolan/state/portolan.db"` | `serve` | SQLite path. `:memory:` gives an ephemeral store. |
| `traces` | string | `".portolan/state/traces"` | `mcp`, `serve`, `map` | Recorded traces (JSONL + HAR). `TRACES_DIR` overrides it. |
| `host` | string | `"127.0.0.1"` | `serve` | Listen address. |
| `port` | integer ≥ 0 | `4200` | `serve` | Listen port. `0` asks the OS for one. |
| `baseUrl` | string | unset | `map`, `compile`, `verify` | Live site origin, used when `--url` / `--base-url` is not passed. |
| `chrome` | string | unset | `map`, `compile`, `verify` | Chrome binary. Unset means `CHROME_PATH`, then the usual install paths. |
| `storageState` | string | unset | `map`, `verify`, `compile`, `mcp`, `serve` | Playwright storage state for pages behind auth. `PORTOLAN_STORAGE_STATE` overrides it. |
| `start` | string | unset | `map` | Command that boots the app, e.g. `"npm run dev"`; used with `--verify`. |
| `headless` | boolean | `true` | `map`, `compile`, `verify` | Run Chromium headless. `--headed` overrides it to `false`. |
| `sessionTtlMs` | integer ≥ 1 | `1800000` (30 min) | `serve` | Idle time after which a session is closed. |
| `maxOpenSessions` | integer ≥ 1 | `100` | `serve` | A create at the cap returns `429 session_limit`. |
| `cleanupIntervalMs` | integer ≥ 1 | `60000` (60 s) | `serve` | How often the expiry sweep runs. |
| `recoverSessions` | boolean | `true` | `serve` | Close sessions left open by a previous process at startup. |
| `logLevel` | `debug` \| `info` \| `warn` \| `error` | `"info"` | `serve` | Structured log threshold. |

## Example

```json
{
  "site": "store",
  "maps": ".portolan/maps",
  "skills": ".portolan/skills",
  "policies": ".portolan/policies",
  "database": ".portolan/state/portolan.db",
  "traces": ".portolan/state/traces",
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
| `PORTOLAN_CONFIG` | `./.portolan/config.json` | Config file, when `--config` is absent. |
| `QA_CONFIG` | `./.portolan/config.json` | Config file for the QA runner, when `--config` is absent. |
| `CHROME_PATH` | auto-detect | Chrome binary, when `chrome` is unset. |
| `PORTOLAN_INSTANCE_ID` | unset | Stable id used to reap a hard-killed predecessor's browsers. |
| `PORTOLAN_AUTH_TOKEN` | unset | Bearer token for `serve`; required for a non-loopback bind unless `PORTOLAN_ALLOW_REMOTE=1`. |
| `PORTOLAN_ALLOW_REMOTE` | unset | `1` opts a non-loopback bind in without a token. |
| `PORTOLAN_<SITE>_<KEY>` | unset | Site-scoped credential, e.g. `PORTOLAN_STORE_API_KEY`. |
| `ANTHROPIC_API_KEY` | unset | Anthropic provider for compile and repair. |
| `OPENAI_API_KEY` | unset | OpenAI provider for compile and repair. |
| `GEMINI_API_KEY` | unset | Gemini provider. |
| `OLLAMA_HOST` | unset | Local Ollama endpoint. |
| `DATABASE_PATH` | `.portolan/state/portolan.db` | Used by `start.ts` (the bare server process), not `portolan serve`. |
| `TRACES_DIR` | `.portolan/state/traces` | Recorded traces for `mcp`, `serve`, and `map`. |
| `PORTOLAN_STORAGE_STATE` | unset | Playwright storage state for authenticated pages. |
| `PORT` / `HOST` | `4200` / `127.0.0.1` | Used by `start.ts`, not `portolan serve`. |

`portolan doctor` reports which provider variables are set without printing
their values.

## Sync

`sync` tells `map sync` which pages a changed file affects.

```json
{
  "sync": {
    "src": "src",
    "routesFrom": "react-router",
    "paths": { "src/components/admin/**": ["admin_*"] }
  }
}
```

`paths` maps a source glob to state ids (globs allowed). `routesFrom` (`react-router`,
`next`, `sveltekit`) reads the route table under `src` so a changed route file affects its
own page.

## Site policy

`.portolan/policies/<site>.json` controls what a site may reach and what must not
be mapped or run unattended.

```json
{
  "site": "app",
  "allow": ["localhost:5173", "localhost:8000"],
  "rules": [
    { "category": "cost", "request": "POST */ask/stream*", "reason": "LLM call" },
    { "category": "destructive", "label": "\\bdelete\\b" },
    { "category": "dev-only", "label": "^Open Tanstack query devtools$" }
  ]
}
```

- `allow` is default-deny. `portolan init --url <app>` seeds it, and
  `portolan policy allow --site app localhost:8000` adds hosts.
- A rule matches a control's accessible name (`label`, a regex), a request its
  recorded run fired (`request`, a method and a URL glob), or both.
- A control that matches is `excluded` in `capabilities.json` with the reason
  `category: reason`. The shipped rules cover sign-out, delete, billing, and page
  chrome; yours are added to them.
- A recorded op whose run fired a `cost` or `destructive` request is marked
  `write` (or `irreversible` for a `ui` op) and is not verified unless
  `map build --allow-cost` is passed.

## Not in the config file

These are programmatic options, passed to `createServer` by a host:

| Option | Default | Meaning |
|---|---|---|
| `store` | required | A `SessionStore`. The server never creates or closes it. |
| `maps` | unset | A `MapStore`; enables `GET /v1/sites/:site/health` and the MCP surface. |
| `executor` | `notReadyExecutor` | The op executor. |
| `canary` | unset | A `CanaryScheduler`, started and stopped with the server. |
| `browsers` | new registry | `BrowserRegistry` for session-owned engines. |
| `substrateFactory` | unset | Creates the browser substrate for `view`, `act`, and `read`. |
| `ledger` | the store's SQLite ledger | The write idempotency ledger. |
| `traceStore` | unset | A `TraceStore` for fallback and explore traces. |
| `logger` | `false` | Fastify's request log. |
| `log` | unset | A structured `Logger` for lifecycle events. |

They are not config keys because they are live objects, not data: a config file
cannot name a function or a database handle.
