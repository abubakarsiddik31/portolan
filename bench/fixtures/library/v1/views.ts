import type { Book, Loan } from "./data.js";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

const STYLES = `
  body { margin: 0; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; color: #1b1d1f; background: #f7f6f2; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #d9d4c8; background: #fffdf8; }
  .brand { font-weight: 700; color: #1b1d1f; text-decoration: none; }
  main { max-width: 900px; margin: 0 auto; padding: 28px 24px 60px; }
  h1 { font-size: 1.9rem; margin: 0 0 18px; }
  form { display: grid; gap: 10px; max-width: 480px; }
  label { font-weight: 600; font-size: 0.9rem; }
  input, select { font: inherit; padding: 9px 10px; border: 1px solid #d9d4c8; border-radius: 7px; background: #fff; }
  button, .button { font: inherit; cursor: pointer; display: inline-block; padding: 9px 14px; border: 1px solid #2f5d50; border-radius: 7px; background: #2f5d50; color: #fff; text-decoration: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-top: 18px; }
  .card { background: #fffdf8; border: 1px solid #d9d4c8; border-radius: 10px; padding: 16px; }
  .muted { color: #6b675f; font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #d9d4c8; }
  .error { color: #9b2c2c; font-weight: 600; }
`;

function layout(title: string, body: string, loanCount: number): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Portolan Library</title><style>${STYLES}</style></head>
<body>
  <header><a class="brand" href="/">Portolan Library</a><a href="/loans" data-testid="loans-link">Loans (${loanCount})</a></header>
  <main>${body}</main>
</body>
</html>`;
}

export function catalogPage(
  books: Book[],
  query: string,
  loanCount: number,
  variant: "v1" | "v2" = "v1",
): string {
  const cards = books
    .map(
      (book) => `<article class="card" data-testid="book-card">
        <h2><a href="/books/${book.id}">${escapeHtml(book.title)}</a></h2>
        <p class="muted">${escapeHtml(book.author)} · ${escapeHtml(book.genre)}</p>
        <p class="muted">${book.available ? "Available" : "On loan"}</p>
      </article>`,
    )
    .join("");

  return layout(
    query ? `Search: ${query}` : "Catalog",
    `<h1>${query ? `Results for “${escapeHtml(query)}”` : "Catalog"}</h1>
     <form method="get" action="${variant === "v2" ? "/catalog" : "/search"}" role="search">
       <label for="q">${variant === "v2" ? "Find books" : "Search books"}</label>
       <input id="q" name="q" value="${escapeHtml(query)}" placeholder="title, author, genre">
       <button type="submit">${variant === "v2" ? "Find" : "Search"}</button>
     </form>
     <section class="grid" data-testid="book-grid">${cards || "<p>No books found.</p>"}</section>`,
    loanCount,
  );
}

export function bookPage(book: Book, loanCount: number, variant: "v1" | "v2" = "v1"): string {
  return layout(
    book.title,
    `<p><a href="/">← Back to catalog</a></p>
     <article data-testid="book-detail">
       <h1>${escapeHtml(book.title)}</h1>
       <p>${escapeHtml(book.author)}</p>
       <p class="muted">${escapeHtml(book.genre)} · ${book.available ? "Available" : "On loan"}</p>
       ${
         book.available
           ? `<form method="post" action="/books/${book.id}/borrow">
                <button type="submit" data-testid="borrow-book">${variant === "v2" ? "Check out" : "Borrow"}</button>
              </form>`
           : '<p class="muted">This copy is already on loan.</p>'
       }
     </article>`,
    loanCount,
  );
}

export function loansPage(loans: Loan[], loanCount: number): string {
  const rows = loans
    .map(
      (loan) =>
        `<tr data-testid="loan-row"><td>${escapeHtml(loan.title)}</td><td>${escapeHtml(
          loan.id,
        )}</td><td>${escapeHtml(loan.borrowedAt)}</td></tr>`,
    )
    .join("");

  return layout(
    "Loans",
    `<h1>Your loans</h1>
     ${
       loans.length === 0
         ? '<p data-testid="loans-empty">No books on loan.</p>'
         : `<table data-testid="loan-table"><thead><tr><th>Title</th><th>Loan</th><th>Borrowed</th></tr></thead><tbody>${rows}</tbody></table>`
     }`,
    loanCount,
  );
}

export function errorPage(message: string, loanCount = 0): string {
  return layout("Something went wrong", `<h1>${escapeHtml(message)}</h1>`, loanCount);
}
