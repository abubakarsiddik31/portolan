# Changesets

Every user-visible change to a published package needs a changeset:

```bash
pnpm changeset
```

A changeset names the packages and the bump (`patch`, `minor`, or `major`) and
writes a short summary. The release workflow turns the accumulated changesets
into a "Version Packages" pull request; merging it publishes the packages and
creates the GitHub release.

The packages start at `0.0.0`, so the first release is a `minor` bump to
`0.1.0`. `@abubakarsiddiik/bench` is private and ignored.
