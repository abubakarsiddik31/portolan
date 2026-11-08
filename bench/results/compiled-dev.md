# Compiled dev fixtures

| Site | Oracle ops | Compiled | Coverage | Yield | Held | Tier mix (compiled) | Tier mix (oracle) |
|---|---|---|---|---|---|---|---|
| store | 8 | 4 | 50% | 100% | checkout | url 3, http 1 | url 4, http 2, ui 2 |
| portal | 4 | 3 | 75% | 100% | — | url 2, ui 1 | url 3, ui 1 |

Missing ops are the ones no trace exercised or no lift supported:
- store: `checkout` is irreversible and held for review; `list_products_api` and `get_product_api` were never exercised; `open_checkout` is static and does not lift; `view_cart` is inherited as the write's outcome check.
- portal: `export_csv` needs download capture; `login` is inherited because the auth block names it.
- wizard: covered separately by `wizard-compile.test.ts`; this report does not include it.
