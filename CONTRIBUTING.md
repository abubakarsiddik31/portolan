# Contributing

Portolan is built task-first. Every change maps to a task ID in
[`docs/PROJECT_PLAN.md`](./docs/PROJECT_PLAN.md), one branch, one pull request.
PRs merge with a merge commit, so the branch commits stay in history.

## Setup

Requirements: Node 24 LTS (minimum 22.12) and pnpm 10.

```bash
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## Commit convention

Conventional Commits with a lowercase, imperative subject:

```
<type>(<scope>): <verb> <what>

<body: why, wrapped at 72 where practical>

Refs: T2.13
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
- **Scopes:** `protocol`, `substrate`, `runtime`, `compiler`, `model`, `skills`, `server`,
  `cli`, `bench`, `fixtures`, `docs`, `tooling`. Scope is optional for docs and chores.
- **Subject:** imperative verb, all lowercase, no trailing period, 72 characters or fewer.
- **One logical change per commit.** Refactors separate from behavior changes. Tests in the
  same commit as the code they test.
- **Body:** explain *why*, not *what*. The diff already says what.
- **Breaking changes:** `!` after the type and a `BREAKING CHANGE:` footer.

Examples:

```text
feat(runtime): add read-only state router
fix(substrate): return stale_ref when the document version moves
docs(plan): record the g0 decision
```

Not:

```text
Added Router.
feat: Add Router
feat(runtime): add router.
```

The rules are enforced by `commitlint` in CI (`.github/workflows/commitlint.yml`). A
non-conforming commit or PR title fails the check.

## Branches and pull requests

- Branch: `<type>/<task-id>-<slug>`, for example `feat/t2.13-act-hit-test`.
- One task per branch and PR. If a task grows, split it and update the plan.
- PR title follows the commit convention; commitlint checks it and every branch commit.
- Fill the PR template: what, task ID, why, test plan, checklist.
- Do not merge with a red CI run. Do not merge credentials, tokens, or captured page text.

## Code

- TypeScript strict mode. No `any` without a comment explaining why.
- `NodeNext` modules; relative imports use the `.js` extension.
- Biome formats and lints. Run `pnpm lint:fix` before committing.
- Tests use Vitest. Put package tests next to the code as `*.test.ts`; repo-level tests go
  in `test/`.
- Prefer a small, typed module over a framework. Add a dependency only when the standard
  library or an existing dependency cannot do the job.

## Releasing

Changesets drives releases: add a `.changeset/*.md` file in the feature PR, merge
the feature PR, then merge the resulting `chore(release): version packages` PR.
The release workflow publishes to npm and creates the `vX.Y.Z` GitHub release.
See [docs/RELEASING.md](./docs/RELEASING.md) for the full checklist, secrets,
and recovery steps.

## Gates

The project can stop at G0, G1, or G2 (see `docs/PROJECT_PLAN.md` §7). Do not build past a
gate that has not passed. Decisions go in `docs/DECISIONS.md` as an ADR, not in a chat.
