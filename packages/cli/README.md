# @portolan/cli

The `portolan` command. Today it ships `doctor`; the rest of the commands
(`init`, `serve`, `compile`, `verify`, `export-skills`, `bench`) land in T5.06.

## Run

```bash
pnpm --filter @portolan/cli build
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js doctor --json
```

## doctor

`portolan doctor` diagnoses the local install without changing anything:

| Check | What it looks for | Status when missing |
|---|---|---|
| `node` | Node 22.12 or newer | fail |
| `browser` | `CHROME_PATH`, then Chrome/Chromium in the usual locations; runs `--version` | fail |
| `config` | `PORTOLAN_CONFIG`, else `./portolan.config.json`; must parse as a JSON object | fail if invalid, warn if absent |
| `providers` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_HOST` | warn |
| `clients` | Claude Desktop, Claude Code, Cursor, VS Code, Gemini CLI, Codex configs; reports whether any names `portolan` | warn |

Exit code is `0` when no check failed (warnings allowed), `1` on a failure,
and `2` for an unknown command. `--json` prints the report as JSON.

Provider values are never printed, only the provider names.

## Tests

`src/doctor.test.ts` injects the environment, filesystem, and Chrome probes, so
it runs on a machine with no browser and no client configs.
