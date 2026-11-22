# Releasing

Portolan publishes every public package independently, but the GitHub release is
named after the CLI. A release has two halves: npm and the umbrella `vX.Y.Z`
release.

## The normal flow

1. **Add a changeset** in the feature PR:

   ```bash
   pnpm changeset
   ```

   Choose the packages and the bump (`patch`, `minor`, or `major`). Commit the
   `.changeset/*.md` file with the code.

2. **Merge the feature PR.** The release workflow runs and opens or updates a
   `chore(release): version packages` PR. It does not publish yet.

3. **Merge the version PR.** This applies the bumps, updates changelogs, and
   removes the consumed changeset files.

4. **The release workflow publishes.** On that push it runs
   `pnpm release:ci`, which publishes every unpublished package to npm and
   creates the package tags. The same workflow then creates the umbrella
   `vX.Y.Z` GitHub release, using the CLI version.

5. **Verify:**

   ```bash
   npm view @abubakarsiddiik/portolan version
   gh release list --limit 5
   ```

## Versions are independent

Changesets bumps only the packages a change touches, plus dependants. A release
can therefore look like this:

| Package | Version |
|---|---|
| `@abubakarsiddiik/portolan` | 0.2.0 |
| `@abubakarsiddiik/sources` | 0.2.0 |
| `@abubakarsiddiik/qa` | 0.1.2 |
| `@abubakarsiddiik/runtime` | 0.1.1 |
| `@abubakarsiddiik/model` | 0.1.0 (unchanged) |

The umbrella tag follows `packages/cli/package.json`, not the highest version
across every package.

## Secrets and permissions

- `NPM_TOKEN` must be set in repository secrets and must be allowed to publish
  the `@abubakarsiddiik` scope. Without it, `release:ci` skips publishing and
  the umbrella release step is skipped too.
- The workflow needs `contents: write` to create tags and releases, and
  `id-token: write` for provenance.

## Manual fallback

If the workflow cannot publish:

```bash
pnpm version-packages
pnpm build
pnpm release          # changeset publish
gh release create "v$(node -p "require('./packages/cli/package.json').version")" \
  --target main --generate-notes
```

## Troubleshooting

- **`npm view` shows an old version.** The registry and npm CLI cache lag.
  Check the exact version instead: `curl -sS https://registry.npmjs.org/@abubakarsiddiik%2fportolan/0.2.0`.
- **A release page is missing but the tag exists.** The umbrella release was
  created manually in earlier releases. From v0.2.0, the release workflow
  creates it. Backfill with `gh release create vX.Y.Z --verify-tag`.
- **Commitlint rejects a release-adjacent commit.** Subjects are lowercase, so
  use `dom`, not `DOM`. The PR title is checked too.
- **The version PR is open but nothing published.** Merging the feature PR only
  prepares the version PR. npm publishes when the version PR is merged.
