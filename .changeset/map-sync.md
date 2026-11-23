---
"@abubakarsiddiik/sources": patch
"@abubakarsiddiik/portolan": patch
---

`portolan map sync --since <git-ref>` keeps a map in step with the code: it maps the changed files to the pages they affect (config globs, plus a route table read from source), updates and verifies only those states, repairs an op whose control was renamed to a clearly closest match, and marks one it cannot repair stale. `portolan map coverage --diff <v3|git-ref>` lists new missing, stale and mapped capabilities, exits 1 on `--fail-on` regressions, and writes a pull request comment with `--markdown`. The guide has a GitHub Actions recipe.
