# Releasing

Every public package is versioned and published independently by
[Changesets](https://github.com/changesets/changesets). The GitHub release is
named after the CLI (`@abubakarsiddiik/portolan`), so one release page can cover
several package versions.

## The flow

1. Add a changeset with `pnpm changeset` in the feature PR.
2. Merge the feature PR. The release workflow opens a
   `chore(release): version packages` PR.
3. Merge that PR. The workflow publishes every unpublished package and creates
   the `vX.Y.Z` GitHub release from the CLI version.

A release can bump only a few packages. For example:

| Package | Version |
|---|---|
| `@abubakarsiddiik/portolan` | 0.2.2 |
| `@abubakarsiddiik/sources` | 0.2.2 |
| `@abubakarsiddiik/qa` | 0.1.4 |
| `@abubakarsiddiik/model` | 0.1.0 (unchanged) |

The umbrella tag always follows `packages/cli/package.json`.

## Verifying

```bash
npm view @abubakarsiddiik/portolan version
gh release list --limit 5
```

The npm registry and CLI cache can lag; query the exact version when in doubt.

The full maintainer checklist, secrets, and recovery steps live in
[RELEASING.md](https://github.com/abubakarsiddik31/portolan/blob/main/docs/RELEASING.md).
