---
"@abubakarsiddiik/substrate": patch
"@abubakarsiddiik/qa": patch
"@abubakarsiddiik/portolan": patch
---

Fix QA process hangs, repair on minimal cases, and map coverage on refresh.

- `@abubakarsiddiik/substrate`: `Substrate.close()` closes the underlying
  browser. The QA runner and repair paths already called an optional `close()`;
  without it, every `qa run`, `qa verify`, and `qa repair` printed results and
  then hung with a leaked Chromium process.
- `@abubakarsiddiik/qa`: rehydrate stored case specs through the schema so
  optional arrays (`setup`, `expect`, `tags`) exist even for rows written from a
  minimal file. `qa repair` no longer fails with "steps is not iterable" on a
  case that omits `setup`. The installed skill also stops telling agents to
  call a nonexistent `qa_doctor` MCP tool and lists the real tool surface.
- `@abubakarsiddiik/portolan`: `map build/update` keeps a live capability
  `mapped` when the published map already has an op for it, instead of marking
  it missing after a refresh. `qa init` now tells the agent to read the skill.
