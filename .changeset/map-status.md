---
"@abubakarsiddiik/server": patch
"@abubakarsiddiik/portolan": patch
---

`portolan map status` shows where the mapping loop stands (version, coverage, recorded runs not yet compiled, the last build's failures grouped by reason, auth expiry, and the next command), and every build is journaled to `.portolan/state/builds.jsonl`. `portolan mcp` adds `map_status`, `map_gaps`, `capability_set`, `map_record_gaps`, `map_build` and `map_job`, so an MCP-only client can finish a map; the two that run a browser need `confirm: true`.
