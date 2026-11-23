---
"@abubakarsiddiik/portolan": patch
"@abubakarsiddiik/qa": patch
"@abubakarsiddiik/protocol": patch
"@abubakarsiddiik/server": patch
---

Keep every project file Portolan creates under `.portolan/`, with committed
artifacts and an ignored `state/` directory in one place. Add
`.portolan/config.json` discovery with a legacy `portolan.config.json`
fallback, `portolan migrate`, and `.mcp.json` opt-in wiring for QA.

Also fix `portolan --version`, `qa --help`, failed `absent` check details,
`qa doctor` hints, and the missing-suite message.
