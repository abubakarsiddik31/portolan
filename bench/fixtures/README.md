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
| library | `/search` → `/catalog`; "Search books" → "Find books"; "Borrow" → "Check out"; `/api/books` reads `query`, not `q` |
| support | "Email" → "Work email"; "Status" → "Ticket status"; `status` → `state`; `page` → `p`; `/tickets/new` → `/requests/new`; the ticket API reads `urgency`, not `priority` |

`v2.test.ts` runs the v1 maps against the v2 apps and asserts that the known
ops break: a moved route, a renamed label, a blocked click, a query key that no
longer filters, and a page that no longer matches its state URL.

## Held-out fixtures

`library` and `support` are the two held-out fixtures. They are not in the dev
task set and have their own v1/v2 drift. `heldout.test.ts` runs six scripted
happy paths and checks the predicates directly:

- library: search and borrow on v1 and v2;
- support: sign in and create a ticket on v1 and v2;
- support: filter tickets on v1 and v2, including the changed query key.

The v1 and v2 apps run on separate ports; `fixtures:library:v2` and
`fixtures:support:v2` start them.
