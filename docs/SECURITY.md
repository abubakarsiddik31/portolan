# Security

Threat model and the write-path review for Portolan v0.1. This is a working
document: the findings list is the source of truth for what is fixed and what
is still open.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Site credentials | OS keychain or `PORTOLAN_<SITE>_<KEY>` | Account takeover |
| Session cookies | Chromium profile | Account takeover |
| Write operations | `runWrite`, op executor | Money, inventory, irreversible state |
| Idempotency ledger | `MemoryWriteLedger` | Double-spend on retry |
| Audit log | SQLite `audit_log` | Who did what; contains params |
| Traces and HAR | `TraceStore`, exported files | Request bodies, PII |
| Maps | `maps/<site>/v<n>.json` | Execution plan and egress intent |
| Skills | `skills/portolan-<site>` | Agent instructions |
| Browser | Chromium behind the substrate | Sandbox boundary |

## Trust boundaries

```
model / MCP client        semi-trusted: can call any tool, can be prompt-injected
        │  MCP (stdio or HTTP)
        ▼
Portolan server           trusted code
        │
        ├── maps, policies, config, SQLite     operator-controlled
        │
        ▼
browser substrate         executes page JS
        │
        ▼
web page                  UNTRUSTED: text, element names, redirects, downloads
```

The page is never trusted. The model is trusted to follow the protocol, not to
resist an injection. The operator's maps and policies are trusted artifacts;
a malicious map is equivalent to a malicious operator.

## Threats and mitigations

| Threat | Mitigation | Where |
|---|---|---|
| Credential appears in a map, trace, log, or skill | Site-scoped credential store; audit/trace redaction by key and value shape; skill secret scan | `credentials.ts`, `redact.ts`, `skills/export.ts` |
| A QA case reads a host secret (`${env.AWS_SECRET_ACCESS_KEY}`) or puts one in a URL | Only `QA_*` variables resolve, and only in a step's `value` or `params`; `goto`, `contains`, and `pattern` reject them | `qa/fixtures.ts`, `qa/runner.ts` |
| A resolved QA secret appears in a result, event, evidence file, or DB row (a failed fill echoes `expected`) | The attempt records every resolved value and scrubs raw, URL-encoded, JSON-escaped, and base64 forms before output; values under four characters are not scrubbed | `qa/fixtures.ts`, `qa/runner.ts` |
| A credential is typed on another site | With `--env`, an `${env.QA_*}` value resolves only while the page is on the environment's origin, and `goto` off the origin fails | `qa/runner.ts` |
| A QA run writes to prod | `writes` defaults to `false`: cases with a non-read `effect` are skipped and the browser context aborts non-GET/HEAD/OPTIONS requests. The environment block is parsed strictly, so a typo fails instead of defaulting | `qa/environments.ts`, `substrate/playwright-engine.ts` |
| A saved session is committed, world-readable, or half-written | Sessions are stored under `$PORTOLAN_HOME`, outside the repo, written `0600` in a `0700` directory and renamed into place; `auth login --env` waits for the person to confirm | `cli/commands/auth.ts`, `qa/environments.ts` |
| Off-allowlist request leaves the page | Default-deny egress guard on `fetch` and `goto`; the final URL after a redirect and the resolved address are checked too; every block recorded | `substrate/policy.ts`, `substrate/substrate.ts` |
| Page text becomes a tool call | Every page-derived MCP result is labeled `untrusted` with a notice; injection fixture asserts the scripted runner never calls a tool | `server/mcp.ts`, `bench/security` |
| Irreversible write without consent | `confirm: true` required before dispatch | `runtime/write.ts` |
| Retry double-writes | Idempotency key replays a completed result; a pending key is reconciled with `outcome_check`; a failed-after-dispatch write returns `unknown_outcome` and is never retried blindly | `runtime/write.ts` |
| Idempotency key reused for another op/site returns the wrong result | **Fixed:** collision returns `invalid_params` with `idempotency_key_reused` | `runtime/write.ts` |
| A restart loses the write ledger, so a retry can double-write | **Fixed:** the ledger is a SQLite table; a `pending` record from a dead process is settled to `unknown` at startup | `server/write-ledger.ts`, `server/store.ts` |
| `serve` and `mcp` had no substrate factory, so the fallback verbs and egress policies were unavailable outside tests | **Fixed:** `createServer` takes a `substrateFactory`; `serve` and `mcp` share one that launches Chrome, registers the engine, and loads `policies/<site>.json` | `server/server.ts`, `cli/browser.ts` |
| `serve` had no authentication and could bind a public interface | **Fixed:** `authToken` adds a constant-time bearer check to every route except `/v1/health`; a non-loopback bind is refused without a token or `PORTOLAN_ALLOW_REMOTE=1` | `server/server.ts`, `server/host.ts` |
| A redirect could land outside the allowlist | **Fixed:** `fetch` reports the final URL and the guard checks it, recording `reason: "redirect"` | `substrate/substrate.ts` |
| A credential in a free-text field survived key-based redaction | **Fixed:** values are also matched by shape — provider keys, GitHub/AWS/Google/Stripe tokens, JWTs, SSNs, and Luhn-valid card numbers | `runtime/redact.ts`, `server/log.ts` |
| The Docker image ran Chromium with `--no-sandbox` unconditionally | **Documented and configurable:** the wrapper defaults to `--no-sandbox` and the image is trusted-sites only; `PORTOLAN_CHROME_SANDBOX=1` drops it for a host with a seccomp profile | `docker/chromium.sh`, `Dockerfile` |
| A hostname could resolve to a private address (DNS rebinding) | **Fixed with a caveat:** the guard resolves an allowlisted name before the request and refuses a private, loopback, link-local, CGNAT, or reserved address | `substrate/policy.ts` |
| Site name escapes the maps directory | **Fixed:** `MapStore` accepts only `[A-Za-z0-9][A-Za-z0-9._-]*` and rejects `..` | `server/maps.ts` |
| Orphan browsers after a crash | Session TTL/cap/recovery; `reapOrphans` kills tagged Chromium | `server`, `substrate/reaper.ts` |
| Session leak from a previous process | Startup recovery closes every open session | `server/server.ts` |
| Unbounded sessions or browsers | `maxOpenSessions` returns `429 session_limit`; idle sweep | `server/server.ts` |
| Audit log records a secret | Params redacted by key and value shape before the insert | `runtime/redact.ts` |
| Arbitrary file read via file upload | `act` rejects `files` until upload is implemented | `server/mcp.ts` |
| Malicious map exfiltrates data | Egress policy is the control; a map cannot widen it | `substrate/policy.ts` |

## The write path

`runWrite` is the only place a write is allowed to reach the page. Its order:

1. **Confirmation.** An `irreversible` op without `confirm: true` returns
   `needs_confirmation` and never calls the executor.
2. **Key collision.** A key already used for a different site or op returns
   `invalid_params` (fixed in this review).
3. **Replay.** A `done` key returns the stored result with `replayed: true`.
   The record is in SQLite, so a replay survives a restart.
4. **Unknown.** An `unknown` key returns `unknown_outcome`; the caller must
   not retry.
5. **Pending.** With an `outcome_check`, the check decides `done` (replay) or
   `unknown` (refuse). Without one, the call is refused.
6. **Dispatch.** The executor runs once. A thrown error is treated as
   after-dispatch, not as a clean failure.
7. **Reconcile.** A failure that may have reached the server runs the
   `outcome_check`; `done` records the result, `not_done` may be retried,
   `unknown` is recorded and refused.
8. **Audit.** The outcome and redacted params are written to SQLite.

What is proven by tests: confirmation, replay, pending reconciliation, the
three failure classes, thrown errors, and the key-collision fix
(`packages/runtime/src/write.test.ts`).

## Findings

### Fixed in this review

| Finding | Fix |
|---|---|
| A reused idempotency key returned another op's result | Collision check on site and op, `invalid_params`; two tests |
| `MapStore` joined an unvalidated site name, so `../` escaped the maps directory | Site-name allowlist and `..` rejection; test |

### Ticketed

| Issue | Finding | Why it is not fixed here |
|---|---|---|

## Residual risks

- **Prompt injection is not solved by the label.** The `untrusted` flag tells a
  well-behaved client what the data is. A model can ignore it; the server
  enforces writes, not the label.
- **The model chooses the op and params.** A prompt-injected model can call a
  real `checkout` with attacker-chosen values if it has `confirm: true`. The
  confirmation is a protocol requirement, not a human approval.
- **Maps are trusted code-like artifacts.** An op can name any URL or selector.
  Egress policy limits where it can go; it does not judge intent.
- **A page can navigate itself.** `location` changes and form posts are not
  intercepted by `Substrate.fetch`/`goto`; only those verbs are guarded.
- **A redirect is checked after it is followed.** The guard refuses to return
  the response and records the block, but the request already reached the
  redirect target. Blocking before the hop needs a browser request route.
- **The rebinding check is a pre-flight lookup, not address pinning.** The
  browser resolves the name again when it connects, so a name that changes
  between the two lookups can still reach a private address. Pinning needs a
  proxy or a request route that sees the resolved address.
- **Local files are readable by the process.** A malicious map or a future
  upload feature is a file-read risk; `act` currently rejects uploads.
- **The audit log is only as complete as the executor.** A write that never
  reaches `runWrite` is not audited.
- **A saved session is as powerful as its account.** Whoever can read the file
  can replay the cookies and skip MFA until the session ends. The file's
  location and mode are the protection. An agent with a shell as the same user
  can read it, as it can read the OS keychain. Use a dedicated read-only
  account for prod; the `writes: false` network guard is a second layer, not a
  substitute. An app that reads over POST needs `writes: true`.
- **A session carries every cookie from sign-in**, including an identity
  provider's. An environment run stays on its origin, but a session that was
  saved through shared SSO can still reach another environment if a page
  redirects there; `goto` off-origin is refused, a server redirect is not.
- **Environment config is a file the agent may be able to edit.** The MCP
  tools cannot change `environments`, but an agent with file or shell access
  can. The boundary is the MCP surface, not the working directory.
- **Redaction covers known credential shapes, not every secret.** A novel
  format, or a secret that looks like ordinary prose, can survive. The field
  name and the value shape are two filters, not a guarantee.
- **No multi-tenant isolation.** One server, one database, one browser pool;
  sessions are not authenticated principals.
- **The benchmark evidence is scripted.** Security claims here are code
  properties and unit tests, not a red-team exercise.

## Reporting

Open a private security advisory on the repository, or email the maintainer
listed in `package.json`. Do not file a public issue for a vulnerability that
lets a page or a client perform a write it was not granted.

## Review scope

Reviewed: `runtime/write.ts`, `server/mcp.ts`, `server/maps.ts`,
`server/server.ts`, `server/store.ts`, `substrate/policy.ts`,
`substrate/substrate.ts`, `substrate/reaper.ts`, `runtime/redact.ts`,
`skills/export.ts`, the Docker image, and the MCP install snippets.

Not reviewed: Chromium itself, Playwright, `better-sqlite3`, the model
providers, and the operating system keychain. Dependency review is separate.
