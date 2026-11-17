# @abubakarsiddiik/skills

Generate a `portolan-<site>` skill from a map version.

```ts
const exported = await exportSkill({
  map,
  traces: successfulTraces,
  gotchas: ["The variant select is required."],
  outDir: "skills",
});
```

The exporter writes:

- `skills/portolan-<site>/SKILL.md` — frontmatter with `name`, `description`,
  and `map_version`; the ops in one line each; recipes mined from successful
  traces; gotchas from the repair history.
- `skills/portolan-<site>/references/ops.md` — the full params and returns
  schemas, loaded only when an agent needs them.

MCP is the source of truth. The skill never executes anything and never
contains credentials.

## Recipes

`mineRecipes(traces, map)` segments each trace, takes the op names in order,
and counts identical sequences. The top five, longest first on a tie, are
rendered as recipes. A trace with fewer than two ops is not a recipe.

## Validation

`validateSkill(raw, { name, mapVersion, map })` checks:

- the frontmatter parses and `name` matches;
- `description` is present and within 1,024 characters;
- `map_version` equals the map's version;
- every op name appears in the body;
- no obvious secret pattern;
- the skill stays under 20,000 characters.

`validateSkillDir(dir, options)` also checks `references/ops.md` and that every
op is named there. `exportSkill` runs the validator on its own output and
throws if it is invalid, so a generated skill cannot drift from the map.
