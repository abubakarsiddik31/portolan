# Packaging

Two artifacts: the `@abubakarsiddiik/*` npm packages and a Docker image with Chromium.

## npm packages

Every package under `packages/` is publishable under the `@abubakarsiddiik` scope:

| Package | What it is |
|---|---|
| `@abubakarsiddiik/protocol` | Types, schemas, and the map loader |
| `@abubakarsiddiik/model` | The provider-agnostic model port |
| `@abubakarsiddiik/substrate` | Browser capture, refs, actions, egress, reaper |
| `@abubakarsiddiik/compiler` | Trace-to-map compiler and verifier |
| `@abubakarsiddiik/runtime` | Op runtime and write safety |
| `@abubakarsiddiik/server` | HTTP and MCP server |
| `@abubakarsiddiik/skills` | Skill exporter |
| `@abubakarsiddiik/portolan` | The `portolan` command |

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

### Release automation

Changesets owns the version bump and the publish.

- **`.changeset/config.json`**: `access: "public"`, `baseBranch: "main"`,
  `updateInternalDependencies: "patch"`, `@abubakarsiddiik/bench` ignored.
- **Every user-visible change adds a changeset** (`pnpm changeset`): the
  packages and a `patch` / `minor` / `major` bump, plus a summary.
- **`.github/workflows/release.yml`** runs on a push to `main`. It opens or
  updates a **Version Packages** pull request. Merging that PR publishes the
  changed packages and creates the GitHub release.
- **`.changeset/initial-release.md`** bumps all eight packages from `0.0.0` to
  `0.1.0`.

The workflow needs `NPM_TOKEN` (an npm automation token for the `@abubakarsiddiik`
scope) and `id-token: write`, which npm uses for provenance. `GITHUB_TOKEN`
comes from the workflow.

Semver: a bug fix is `patch`, a backward-compatible feature is `minor`, and a
breaking change is `major`. Before `1.0.0`, a `minor` is the normal feature
bump; changesets still requires an explicit `major` for a break.

### Dry run

```bash
pnpm build
pnpm release:dry-run --out /tmp/portolan-release
```

The script reads `.changeset/*.md` and writes:

- `RELEASE_NOTES.md` — the version table and every changeset summary.
- `release-plan.json` — current version, bump, and next version per package.
- one `.tgz` per package, via `npm pack`, at the version currently in the
  tree. The next version is in the plan; `changeset version` applies it in the
  Version Packages pull request.

`--notes-only` skips the build and the tarballs. It does not modify the tree.
CI runs the dry run after the build.

### Clean-machine check

`pnpm --filter @abubakarsiddiik/portolan deploy --prod --legacy <dir>` builds a
self-contained tree: the CLI, its `@abubakarsiddiik/*` dependencies, and third-party
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
  -e PORTOLAN_AUTH_TOKEN=change-me \
  portolan
```

A container that should be reachable from the host needs a mounted config
with `"host": "0.0.0.0"`; the default is loopback. A non-loopback bind is
refused without `PORTOLAN_AUTH_TOKEN` (or `PORTOLAN_ALLOW_REMOTE=1`).

The image is a multi-stage build:

1. **build:** `node:24-bookworm-slim`, corepack, `pnpm install
   --frozen-lockfile`, `pnpm build`, then
   `pnpm --filter @abubakarsiddiik/portolan deploy --prod --legacy /out`.
2. **runtime:** `node:24-bookworm-slim` plus Debian's `chromium`,
   `ca-certificates`, and `fonts-liberation`.

Details that matter:

- **`CHROME_PATH=/usr/local/bin/chromium-portolan`**, a wrapper that adds
  `--disable-dev-shm-usage` and, by default, `--no-sandbox`. Chromium's
  renderer sandbox needs unprivileged user namespaces, which the default
  Docker seccomp profile blocks. **The default image is therefore suitable
  only for trusted sites.**
- **`PORTOLAN_CHROME_SANDBOX=1`** drops `--no-sandbox`. It needs a seccomp
  profile that permits user namespaces; `docker-compose.yml` uses
  `seccomp=unconfined` to show the trade-off. Do not run untrusted pages in
  the default image.
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
- **Versions are still `0.0.0` in the tree.** The initial changeset bumps
  them to `0.1.0` when the Version Packages PR merges.
- **The release workflow has not run.** There is no `NPM_TOKEN` or published
  scope in this environment.
