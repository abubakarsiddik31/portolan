# Skills

A skill is knowledge, not execution. MCP carries the calls and the safety; a
skill tells an agent when and how to call them.

## Export

```bash
portolan export-skills --map maps/store/v1.json --out skills
```

The output is `skills/portolan-store/`:

```
portolan-store/
  SKILL.md
  references/ops.md
```

`SKILL.md` has YAML frontmatter with `name`, `description`, and
`map_version`. The body lists every op with its signature and effect, the
recipes mined from successful traces, and any gotchas from repairs.
`references/ops.md` holds the full params and returns schema for each op.

## Recipes

A recipe is a common op sequence, e.g. `search → get_product → add_to_cart`,
counted across traces. It is a hint, not a script: the agent still calls the
ops.

Pass traces to mine them:

```bash
portolan export-skills --map maps/store/v1.json --trace run-1.json --trace run-2.json
```

## Validation

The exporter refuses to write an invalid skill. It checks:

- the frontmatter parses and `name` matches the directory;
- `map_version` matches the map;
- every op name appears in the skill and in the references;
- the document is under the size limits;
- nothing looks like an API key or an AWS access key.

## Versioning

`map_version` is the compatibility contract. If a skill says `map_version: 3`
and the server is on v4, the agent should re-export before relying on the
recipes. The ops themselves are resolved by the server, so a stale skill does
not break execution; it can only mislead.

## What a skill is not

- It is not a tool. It does not execute anything.
- It is not a credential store. It must not contain secrets; the exporter scans
  for the common shapes and fails.
- It is not a substitute for `open_site`. The map is the source of truth.

## The map-building skill

`portolan init` installs `skills/portolan-map/SKILL.md` into the workspace. It is
the authoring counterpart to a site skill: it tells a coding agent how to
inventory capabilities from the codebase and the live app, work
`capabilities.json` until no entry is `missing` or `stale`, record a run for
anything that cannot be auto-discovered, and gate publication with
`--require-complete`. Site skills (`portolan-<site>`) teach an agent how to use
the finished map.
