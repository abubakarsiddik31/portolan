# Op latency

Generated 2026-11-08T23:18:39.259Z with `pnpm --filter @portolan/bench perf`.

| Op | Tier | Runs | p50 | p95 | Max | Budget (p50) |
|---|---|---:|---:|---:|---:|---:|
| store.search | url | 10 | 8.4ms | 9.9ms | 9.859249999999975ms | 150ms |
| store.get_product | url | 10 | 8.5ms | 11.1ms | 11.137083000000075ms | 150ms |
| store.list_products_api | http | 10 | 1ms | 1.8ms | 1.834292000000005ms | 150ms |
| store.get_product_api | http | 10 | 1.8ms | 2.1ms | 2.1302500000000464ms | 150ms |
| store.add_to_cart | ui | 10 | 25.4ms | 27.1ms | 27.135582999999997ms | 500ms |

Budgets: `ui` ≤500ms, `url`/`http` ≤150ms.
