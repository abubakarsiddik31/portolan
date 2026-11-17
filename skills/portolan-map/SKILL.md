---
name: portolan-map
description: Build or update a Portolan map until every capability is mapped or explicitly excluded. Use when the user asks to map a web app, make it testable repeatedly, or keep its map current. Covers both codebase inventory and live exploration.
---

# Build a Portolan map

You are the author; Portolan is the verifier. Enumerate every capability of the
app from the codebase **and** the live app, then either map it to a verified op
or exclude it with a written reason. Never invent an op.

A capability is one user action: a navigation destination, a form submit, a
button that opens a dialog, or a multi-step flow. A page is not a capability.

## The loop

1. **Inventory from the codebase.** Read the routes, API handlers, forms,
   buttons, menus, and existing e2e tests. Add anything the live crawl cannot
   see (feature flags, unlinked routes, admin pages) with:

   ```bash
   portolan map capability add --site <site> --maps ./portolan/maps \
     --page <page> --kind button --name "<label>" --source code
   ```

2. **Inventory from the live app.** Build or update the map. This crawls pages,
   records links/forms/buttons, and writes the ledger:

   ```bash
   portolan map build --site <site> --maps ./portolan/maps \
     --url <app url> [--storage-state ./portolan/auth.json] \
     --verify --publish
   ```

3. **Read the gaps.** `capabilities.json` is the work queue:

   ```bash
   portolan map coverage --site <site> --maps ./portolan/maps --json
   ```

4. **Resolve every `missing` or `stale` entry.** For each one:
   - If the code shows it is obsolete or unreachable, or it is destructive /
     credit-spending, exclude it **with a reason**:

     ```bash
     portolan map capability set --site <site> --maps ./portolan/maps \
       --id <capability id> --status excluded --reason "deletes user data"
     ```

   - Otherwise record one real run and let Portolan compile it. Use the MCP
     tools or the CLI:

     ```text
     open_url(url, intent) → view / act / read → fallback_done(scope_id)
     ```

     ```bash
     portolan map build --site <site> --maps ./portolan/maps \
       --traces-dir ./portolan/traces --verify --publish
     ```

   For dialog and multi-step flows, click the trigger, complete the flow once,
   and close the scope. Do not stop after opening the dialog.

5. **Gate.** Repeat 3–4 until this passes:

   ```bash
   portolan map build ... --require-complete --verify --publish
   ```

   `--require-complete` refuses to publish while any capability is `missing` or
   `stale`. Excluded capabilities are allowed and must carry a reason.

## Rules

- **Code is an inventory, not proof.** A code-derived capability stays
  `missing` until a verified op covers it or you exclude it.
- **Never mark something mapped yourself.** Only `verify` promotes an op.
- **Safe exploration.** Use a dedicated test account and a storage state from
  `portolan auth login`. Never run delete, checkout, upgrade, sign-out, or
  credit-spending actions. Exclude them with a reason.
- **One run per capability.** Record the smallest successful run. Portolan
  lifts the cheapest tier (url → http → ui) and verifies it.
- **Manual decisions survive updates.** A capability you set with
  `map capability` has `source: "manual"`; rediscovery keeps it.
- **Commit the ledger.** `capabilities.json`, `draft.json`, `tasks.json`, and
  `v*.json` are the map. CI can run `map coverage --json` and fail on gaps.
- **Re-run `map update` after app changes.** New actions become `missing`,
  vanished ones become `stale`; do not delete them silently.

## Definition of done

`map coverage` reports `0 missing, 0 stale`, every mapped op verified, every
excluded capability has a reason, and `--require-complete --publish` succeeds.
