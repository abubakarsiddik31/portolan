# @abubakarsiddiik/portolan

## 0.1.1

### Patch Changes

- 0ddb4a0: Add qa_generate and qa_repair, completing the QA package's M2 surface:
  generate turns a loose spec or a recorded trace into a draft case (goto steps
  from route changes, semantic steps from located acts, secret-looking fill
  values become env references), and repair recovers a moved or renamed target
  from a failed run by name similarity, rewrites the case as a draft, records a
  selector drift event, and confirms with one run. Both write through the same
  draft path as qa_case_write; only qa_verify promotes.
- Updated dependencies [0ddb4a0]
  - @abubakarsiddiik/qa@0.1.1

## 0.1.0

### Minor Changes

- 05f2358: Initial public alpha: the map protocol, model port, browser substrate,
  compiler, op runtime, HTTP/MCP server, skill exporter, and the `portolan`
  command.
- 0f9570f: Add local, agent-first QA: a deterministic test runner with a local SQLite
  store, database-derived verification, MCP tools and CLI commands, and case
  files that compose UI steps and map ops. The substrate gains an optional
  viewport screenshot for evidence.

### Patch Changes

- Updated dependencies [05f2358]
- Updated dependencies [0f9570f]
  - @abubakarsiddiik/protocol@0.1.0
  - @abubakarsiddiik/substrate@0.1.0
  - @abubakarsiddiik/compiler@0.1.0
  - @abubakarsiddiik/runtime@0.1.0
  - @abubakarsiddiik/server@0.1.0
  - @abubakarsiddiik/skills@0.1.0
  - @abubakarsiddiik/qa@0.1.0
