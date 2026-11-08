# Open-weights smoke

One held-out task, driven by a local OpenAI-compatible model through the same
runner and arm C backend the benchmark uses.

```sh
# Ollama, for example
ollama serve
ollama pull qwen2.5:7b-instruct

PORTOLAN_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
PORTOLAN_LOCAL_MODEL=qwen2.5:7b-instruct \
pnpm local:smoke
```

`PORTOLAN_LOCAL_API_KEY` is optional; local servers usually ignore it.

The task is `store-search-read#1`: search the catalog for socks and open the
Merino Socks product page. It is small enough for a 7B model and still
exercises typing, submitting a form, and following a link.

The test is skipped without both environment variables. A failure is a real
signal: the model did not finish the template, not that the harness is
misconfigured.
