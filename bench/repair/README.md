# Headless repair

`repair.test.ts` has two layers:

- **Scripted** — a deterministic model that reads the affordance list and acts
  on refs. It always runs when Chrome is available, and proves the loop and the
  trace shape.
- **Live** — the same intent driven by a local open-weights model through the
  OpenAI-compatible adapter. It skips unless both variables are set.

```sh
PORTOLAN_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
PORTOLAN_LOCAL_MODEL=qwen2.5:7b-instruct \
pnpm vitest run bench/repair/repair.test.ts
```

`PORTOLAN_LOCAL_API_KEY` is optional; local servers usually ignore it.

The intent is read-only: search the store for socks and open the Merino Socks
product page. It is small enough for a 7B model and still exercises typing,
submitting a form, and following a link.
