---
"@abubakarsiddiik/qa": minor
"@abubakarsiddiik/substrate": minor
"@abubakarsiddiik/portolan": minor
---

Run QA against named environments (dev, qa, prod) with a saved session per
account, so the agent picks a name and never handles a credential.

- `environments` in `.portolan/config.json`: `baseUrl`, `profiles`, optional
  `loginUrl`, and `writes` (default `false`). Parsed strictly; a typo fails
  instead of leaving prod writable.
- `portolan auth login --env NAME --profile P` signs in once in a real browser
  and waits for you to confirm, then saves the session outside the repo under
  `~/.portolan/sessions` (`PORTOLAN_HOME`), `0600` in a `0700` directory, written
  atomically. `portolan auth status` lists which profiles have one.
- `qa_run`, `qa_verify`, `qa_repair`, and `portolan qa run|verify|repair` take
  `env` and `as`. New `qa_environments` tool lists environments and session
  presence, never a path or a credential. A missing session is `auth_missing`
  with the sign-in command in `details.next`.
- A read-only environment skips non-read cases and the browser aborts
  non-GET/HEAD/OPTIONS requests (`PlaywrightEngine` `readOnly`). A `goto` off
  the environment origin fails, and `${env.QA_*}` values resolve only on it.
- Fix: a resolved `${env.*}` secret could leak through a failed fill's
  `expected`, a `value` check's `actual`, or evidence. Every resolved value is
  now scrubbed from results, events, evidence, and the database in raw,
  URL-encoded, JSON-escaped, and base64 form.
- Breaking: `${env.*}` in a case now resolves only `QA_*` variables, and only
  in a step's `value` or `params`, never in `goto`, `contains`, or `pattern`.
- `auth login` writes the session `0600` from creation instead of `chmod`ing
  afterwards.
