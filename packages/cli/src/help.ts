const CONFIG_FLAG = "  --config <path>        config file (default ./.portolan/config.json)";

const BROWSER_FLAGS = `  --chrome <path>        Chrome binary (default: CHROME_PATH or auto-detect)
  --headed               show the browser window
  --storage-state <file> a signed-in session from \`portolan auth login\``;

/** Help for one command, shown by `portolan <command> --help`. */
export const COMMAND_HELP: Record<string, string> = {
  init: `portolan init [dir] [options]

Create .portolan/ with a config, a site policy, a map directory, and skills.

Options:
  --site <name>          site name (default: from config)
  --url <url>            app URL; its host is written to the policy's allow list
  --force                overwrite files that already exist`,

  migrate: `portolan migrate [dir]

Move a legacy root layout into .portolan/.`,

  serve: `portolan serve [options]

Start the HTTP and MCP server.

Options:
${CONFIG_FLAG}
  --host <host>          interface to bind
  --port <n>             port to listen on
  --database <path>      SQLite session store
  --maps <dir>           maps directory`,

  mcp: `portolan mcp [options]

Serve MCP over stdio, for an MCP client to spawn.

Options:
${CONFIG_FLAG}`,

  auth: `portolan auth <login|status> [options]

login   open a browser, sign in, and save the session for --storage-state
status  list environment profiles and whether a session is saved

Options (login):
  --url <url>            sign-in page
  --out <file>           where to save the session
  --env <name>           use a named environment from the config
  --profile <name>       profile within that environment
  --timeout-ms <n>       how long to wait for sign-in (default 300000)
  --chrome <path>        Chrome binary
${CONFIG_FLAG}`,

  map: `portolan map <build|update|coverage|capability> [traces...] [options]

build     discover --url and/or compile traces into a draft map; --verify and
          --publish turn verified ops into a new map version
update    same as build, reconciled against the existing map
coverage  print mapped vs missing capabilities (--json for machine output)
capability add|set   record a capability manually (--page --name --kind
          --status missing|excluded --reason, or --id --status for set)

Options (build, update):
  --site <name>          site name (default: from config)
  --maps <dir>           maps directory
  --url <url>            entry URL for DOM discovery
  --base-url <url>       origin to verify against (default: --url origin)
  --max-pages <n>        pages to crawl
  --exclude <pattern>    capability name to leave unmapped (repeatable)
  --trace <file>         a recorded trace (repeatable; or pass files directly)
  --traces-dir <dir>     directory holding traces.jsonl
  --outcome-checks <f>   JSON {op name: read op that proves the write}
  --params <file>        parameter sets per op, three or more each
  --start "<cmd>"        command that starts the app before the build
  --verify               run every op on a fresh session
  --verify-writes        also verify writes (they run for real)
  --publish              publish verified ops (needs --verify)
  --require-complete     fail while any capability is missing or stale
  --strict               with --require-complete, also fail on unavailable controls
${BROWSER_FLAGS}
${CONFIG_FLAG}`,

  compile: `portolan compile <trace...> --map <file> [options]

Compile recorded traces into candidate ops, verify them, and publish the ones
that pass as a new map version. A segment the map does not cover is named from
its recorded actions.

Options:
  --map <file>           the map to extend (required)
  --trace <file>         a recorded trace (repeatable; or pass files directly)
  --base-url <url>       origin to capture and verify against
  --outcome-checks <f>   JSON {op name: read op that proves the write}
  --params <file>        parameter sets per op, three or more each
  --verify-writes        also verify writes (they run for real)
${BROWSER_FLAGS}
${CONFIG_FLAG}`,

  verify: `portolan verify --map <file> --params <file> [options]

Run a map's ops on a fresh session and report which pass.

Options:
  --map <file>           map to verify (required)
  --params <file>        parameter sets per op, three or more each (required)
  --op <name>            verify only this op (repeatable)
  --base-url <url>       origin to verify against
${BROWSER_FLAGS}
${CONFIG_FLAG}`,

  "export-skills": `portolan export-skills --map <file> [options]

Export a portolan-<site> skill from a map.

Options:
  --map <file>           map to export (required)
  --out <dir>            output directory (default: skills dir from config)
  --trace <file>         a successful trace to mine recipes from (repeatable)
  --gotcha <text>        a gotcha to record (repeatable)
${CONFIG_FLAG}`,

  bench: `portolan bench [suite] [options]

Run a benchmark suite from the source checkout.

Options:
  --list                 list the available suites`,

  doctor: `portolan doctor [options]

Diagnose the browser, config, providers, and clients.

Options:
  --json                 machine-readable report`,
};
