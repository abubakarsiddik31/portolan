# Held-out tasks

Sixteen templates, five param sets each: eight for `library`, eight for
`support`. They target the v1 held-out fixtures; the v2 variants are for the
drift run.

- library: search/open, borrow, author, genre, empty loans, availability, back
  to catalog, search miss.
- support: login, filter, filter+search, search, search miss, paginate, open a
  ticket, create a ticket.

`heldout.test.ts` runs the first param set of every template through the
scripted repair loop and checks the task predicate against the live page. The
full 80 expanded tasks are for T4.09.
