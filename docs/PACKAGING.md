# Packaging

Two artifacts: the `@portolan/*` npm packages and a Docker image with Chromium.

## npm packages

Every package under `packages/` is publishable under the `@portolan` scope:

| Package | What it is |
|---|---|
| `@portolan/protocol` | Types, schemas, and the map loader |
| `@portolan/model` | The provider-agnostic model port |
| `@portolan/substrate` | Browser capture, refs, actions, egress, reaper |
| `@portolan/compiler` | Trace-to-map compiler and verifier |
| `@portolan/runtime` | Op runtime and write safety |
| `@portolan/server` | HTTP and MCP server |
| `@portolan/skills` | Skill exporter |
| `@portolan/cli` | The `portolan` command |

Each manifest carries:

- `license: "Apache-2.0"` (the repo license).
- `repository.directory` pointing at its folder, so npm links the source.
- `engines.node: ">=22.12.0"`.
- `publishConfig: { "access": "public", "provenance": true }`.
- `files: ["dist"]`, with `main`, `types`, and `exports` pointing into `dist`.

`provenance: true` asks npm for a signed provenance statement; it only works
from CI with an OIDC token (`id-token: write`), not from a laptop.

### Verify before publishing

```bash
pnpm build
pnpm package:check:tarballs
```

`scripts/verify-packages.mjs` checks every manifest and, with `--tarballs`,
runs `npm pack --dry-run` and asserts each tarball contains `dist/` and not
`src/`. `pnpm package:check` runs the manifest half without a build. CI runs
`pnpm package:check:tarballs` after `pnpm build`.

### Publish

Until T5.09 adds Changesets, publish by hand:

```bash
pnpm build
pnpm -r --filter "./packages/*" publish --access public --provenance
```

Order matters only for the first publish: pnpm rewrites `workspace:*` to the
package version, so the registry needs the dependency before the dependent.
T5.09 automates the order, the version bump, and the GitHub release.

### Clean-machine check

`pnpm --filter @portolan/cli deploy --prod --legacy <dir>` builds a
self-contained tree: the CLI, its `@portolan/*` dependencies, and third-party
packages, with no symlinks into the workspace. Run `node <dir>/dist/bin.js
doctor --json` from a directory with no `node_modules`.

- **macOS:** verified here (Node 24, Chrome 156): deploy + `doctor` exit 0.
- **Linux:** the same deploy is exercised inside the Docker build. The image
  itself was not built in this environment (the Docker daemon did not pull a
  base image); treat the Linux path as unverified until CI builds it.

## Docker

```bash
docker build -t portolan .
docker run --rm -p 4200:4200 \
  -v "$PWD/portolan.config.json:/data/portolan.config.json:ro" \
  -v "$PWD/maps:/data/maps:ro" \
  -v "$PWD/policies:/data/policies:ro" \
  -v portolan-data:/data \
  portolan
```

The image is a multi-stage build:

1. **build:** `node:24-bookworm-slim`, corepack, `pnpm install
   --frozen-lockfile`, `pnpm build`, then
   `pnpm --filter @portolan/cli deploy --prod --legacy /out`.
2. **runtime:** `node:24-bookworm-slim` plus Debian's `chromium`,
   `ca-certificates`, and `fonts-liberation`.

Details that matter:

- **`CHROME_PATH=/usr/local/bin/chromium-portolan`**, a wrapper that adds
  `--no-sandbox --disable-dev-shm-usage`. Chromium in a container needs both;
  keeping them in the wrapper leaves the application code unchanged.
- **`/data` is the working directory** and is owned by `node`: config, maps,
  policies, skills, and the SQLite file live there. Mount the read-only inputs
  and a volume for the database.
- **`EXPOSE 4200`** and a `HEALTHCHECK` against `/v1/health`.
- **Runs as `node`**, not root.
- **`CMD ["serve"]`**; override with `docker run portolan doctor --json`.

`.dockerignore` excludes `node_modules`, `dist`, coverage, docs, and the local
maps/policies/skills, but keeps `bench/package.json` so the frozen install can
resolve the workspace.

## Not done here

- **No package has been published.** The scope, the registry, and the OIDC
  provenance identity are T7.06/T7.11.
- **The Docker image was not built in this environment.** The Dockerfile and
  the static checks are in place; CI does not build the image yet.
- **The Docker build re-runs `pnpm install` from the lockfile**, so a private
  registry or an offline machine needs a mirror.
- **Versions are still `0.0.0`.** T5.09 owns the first real version.
