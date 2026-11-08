import type { RowFilters, RowPage } from "./data.js";
import { CATEGORIES, formatMoney, STATUSES } from "./data.js";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

const STYLES = `
  :root { color-scheme: light; --ink: #171a1c; --muted: #667079; --line: #d7dde2; --paper: #f6f8f9; --accent: #245b78; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--paper); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 22px; border-bottom: 1px solid var(--line); background: #fff; }
  .brand { font-weight: 700; letter-spacing: -0.02em; }
  nav { display: flex; align-items: center; gap: 14px; }
  nav a { color: var(--accent); text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  nav form { display: inline; }
  nav button { background: none; border: none; color: var(--accent); cursor: pointer; font: inherit; padding: 0; }
  main { max-width: 1080px; margin: 0 auto; padding: 26px 22px 60px; }
  h1 { font-size: 1.8rem; letter-spacing: -0.03em; margin: 0 0 6px; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .filters { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin: 18px 0; padding: 14px; border: 1px solid var(--line); border-radius: 9px; background: #fff; }
  .filters label { display: grid; gap: 4px; font-size: 0.82rem; font-weight: 600; color: var(--muted); }
  input, select { font: inherit; padding: 8px 9px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  button, .button { font: inherit; cursor: pointer; display: inline-block; padding: 8px 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: #fff; text-decoration: none; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); background: #f1f4f6; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; text-transform: capitalize; }
  .badge.paid { background: #e3f2e8; color: #1f6b3a; }
  .badge.pending { background: #fdf0d5; color: #7a5300; }
  .badge.overdue { background: #fbe3e1; color: #8c2318; }
  .pager { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
  .pager a, .pager span { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: #fff; text-decoration: none; color: var(--ink); }
  .pager a:hover { border-color: var(--accent); }
  .pager .disabled { color: var(--muted); background: #eef1f3; }
  .error { color: #9b2c2c; font-weight: 600; }
  .login { max-width: 380px; margin: 10vh auto; padding: 24px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  .login form { display: grid; gap: 10px; }
  .login label { font-weight: 600; font-size: 0.9rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
`;

function shell(title: string, body: string, email?: string): string {
  const nav = email
    ? `<nav>
        <span class="muted">${escapeHtml(email)}</span>
        <form method="post" action="/logout"><button type="submit">Sign out</button></form>
      </nav>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Portolan Ledger</title>
  <style>${STYLES}</style>
</head>
<body>
  <header>
    <a class="brand" href="/" style="text-decoration:none;color:inherit">Portolan Ledger</a>
    ${nav}
  </header>
  <main>${body}</main>
</body>
</html>`;
}

export function loginPage(error?: string): string {
  return shell(
    "Sign in",
    `<section class="login">
       <h1>Sign in</h1>
       <p class="muted">Demo account: analyst@example.com / portolan</p>
       ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
       <form method="post" action="/login" data-testid="login-form" novalidate>
         <label for="email">Email</label>
         <input id="email" name="email" type="email" autocomplete="username" required>
         <label for="password">Password</label>
         <input id="password" name="password" type="password" autocomplete="current-password" required>
         <button type="submit" data-testid="login-submit">Sign in</button>
       </form>
     </section>`,
  );
}

function pageHref(page: number, filters: RowFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  params.set("page", String(page));
  return `/?${params.toString()}`;
}

function exportHref(filters: RowFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  const query = params.toString();
  return query ? `/export.csv?${query}` : "/export.csv";
}

export function portalPage(page: RowPage, filters: RowFilters, email: string): string {
  const statusOptions = STATUSES.map(
    (status) =>
      `<option value="${status}" ${filters.status === status ? "selected" : ""}>${status}</option>`,
  ).join("");
  const categoryOptions = CATEGORIES.map(
    (category) =>
      `<option value="${category}" ${filters.category === category ? "selected" : ""}>${category}</option>`,
  ).join("");

  const tableRows = page.rows
    .map(
      (row) => `<tr data-testid="invoice-row">
        <td>${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.vendor)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${formatMoney(row.amountCents)}</td>
        <td data-status="${row.status}"><span class="badge ${row.status}">${row.status}</span></td>
        <td>${escapeHtml(row.date)}</td>
      </tr>`,
    )
    .join("");

  return shell(
    "Invoices",
    `<h1>Invoices</h1>
     <p class="muted">${page.total} matching invoices · page ${page.page} of ${page.pages}</p>
     <form class="filters" method="get" action="/" data-testid="filter-form">
       <label>Search <input name="q" value="${escapeHtml(filters.q)}" placeholder="invoice or vendor"></label>
       <label>Status
         <select name="status">
           <option value="">All</option>
           ${statusOptions}
         </select>
       </label>
       <label>Category
         <select name="category">
           <option value="">All</option>
           ${categoryOptions}
         </select>
       </label>
       <button type="submit">Filter</button>
       <a class="button" href="${exportHref(filters)}" data-testid="export-csv">Export CSV</a>
     </form>
     <table data-testid="invoice-table">
       <thead><tr><th>Invoice</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
       <tbody>${tableRows || '<tr><td colspan="6">No invoices match.</td></tr>'}</tbody>
     </table>
     <div class="pager" data-testid="pager">
       ${
         page.page > 1
           ? `<a href="${pageHref(page.page - 1, filters)}" data-testid="page-prev">Previous</a>`
           : '<span class="disabled">Previous</span>'
       }
       <span>Page ${page.page} of ${page.pages}</span>
       ${
         page.page < page.pages
           ? `<a href="${pageHref(page.page + 1, filters)}" data-testid="page-next">Next</a>`
           : '<span class="disabled">Next</span>'
       }
     </div>`,
    email,
  );
}
