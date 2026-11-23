---
"@abubakarsiddiik/portolan": patch
"@abubakarsiddiik/compiler": patch
---

`portolan compile` now verifies each candidate before it publishes, as the docs always said. Reads use the recorded values plus variants; a write runs only with `--verify-writes` and a `--params` file of at least three sets. A step the map does not cover is named from its recorded actions instead of failing with "no candidate ops", and a new write compiles to a `ui` op unless `--outcome-checks` names the read that proves it. `map build` takes `--outcome-checks` too.
