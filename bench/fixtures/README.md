# Fixtures

Each fixture builds v1 by default and v2 with `--variant v2`:

```sh
pnpm fixtures:store       # store v1 on 4100
pnpm fixtures:store:v2    # store v2 on 4110
```

The v2 apps are the drift fixtures. They run, and they break the v1 maps on
purpose:

| Site | v2 drift |
|---|---|
| store | `/search` → `/catalog`; "Search products" → "Find products"; "Size / color" → "Size and color"; "Add to cart" → "Add to bag"; a modal covers checkout; `/api/products` reads `query`, not `q` |
| portal | "Email" → "Work email"; "Status" → "Invoice status"; `status` → `state`; `page` → `p`; `/export.csv` → `/invoices.csv` |
| wizard | `/step/:n` → `/apply/:n`; "Full name" → "Name"; "Work email" → "Email"; "Company" → "Employer"; "Your role" → "Role"; the attachment label changes |

`v2.test.ts` runs the v1 maps against the v2 apps and asserts that the known
ops break: a moved route, a renamed label, a blocked click, a query key that no
longer filters, and a page that no longer matches its state URL.
