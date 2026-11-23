---
"@abubakarsiddiik/qa": patch
---

QA checks retry until the run's timeout instead of judging the first view, so an async page passes without a manual `await` and `absent` cannot pass before the page renders. `await` also takes `visible`, `absent` and `value`. The `url` check and `await url` can assert a query or fragment (`"/analytics\?range=30d"`, or `{ pathname, query, hash }`). A failure's evidence folder gains `text.txt` with the full page text, `page.png` when screenshots are on, and `read_scope` in `result.json` when a dialog scoped the read.
