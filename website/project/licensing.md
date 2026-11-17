# Licensing

Portolan uses three licenses, one per kind of artifact. ADR-008 records the
decision.

| Artifact | License | File |
|---|---|---|
| Runtime, compiler, substrate, server, CLI, skills exporter | Apache-2.0 | [LICENSE](https://github.com/abubakarsiddik31/portolan/blob/main/LICENSE) |
| Cockpit (the human view of a session, not built yet) | MIT | [LICENSE-MIT](https://github.com/abubakarsiddik31/portolan/blob/main/LICENSE-MIT) |
| Map format spec and the JSON Schema as published documentation | CC-BY-4.0 | [LICENSE-CC-BY-4.0](https://github.com/abubakarsiddik31/portolan/blob/main/LICENSE-CC-BY-4.0) |

The split is deliberate:

- **Apache-2.0 for code** gives an explicit patent grant and a patent
  retaliation clause, which a runtime that a company deploys needs.
- **MIT for the cockpit** keeps the UI layer easy to embed and fork.
- **CC-BY-4.0 for the spec** lets another implementation copy and adapt the
  document with attribution, which is the point of a spec.

The `@abubakarsiddiik/protocol` *code* (the loader, validator, and types) is
Apache-2.0. The *spec text and the published schema document* are CC-BY-4.0.
A map a user compiles from their own site is the user's data; these licenses
do not claim it.

## Dependency policy

The default path — what `pnpm install --prod` puts on a user's machine — must
not contain AGPL, GPL, or SSPL. A copyleft dependency would change the terms
for everyone who deploys the runtime.

```bash
pnpm licenses:check
```

The check reads `pnpm licenses list --prod --json`, prints the license counts,
and fails on a denied identifier. A dual-licensed expression is allowed when
one branch is permissive, e.g. `(AFL-2.1 OR BSD-3-Clause)`. `Unknown` and
`UNLICENSED` are listed for review, not failed automatically.

CI runs the check after the build.

Dev dependencies are not covered: a test runner or a linter never ships. A
dependency that moves from dev to production must be checked.

## Contributing

By contributing code you agree it is licensed under Apache-2.0. There is no
separate CLA. See [CONTRIBUTING.md](https://github.com/abubakarsiddik31/portolan/blob/main/CONTRIBUTING.md).

## Not covered here

- **Trademark.** The code license does not grant rights to the Portolan name
  or logo; that is T7.06.
- **The site maps in `maps/`.** They are fixtures for the test suite, not a
  published dataset.
- **Third-party site terms.** A map of a site does not grant permission to
  automate it; that is a per-site legal review (T6.04).
