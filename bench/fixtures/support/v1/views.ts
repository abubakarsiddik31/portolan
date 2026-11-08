import type { Ticket, TicketFilters } from "./data.js";
import { PRIORITIES, STATUSES } from "./data.js";

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
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: #171a1c; background: #f6f8f9; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 14px 22px; border-bottom: 1px solid #d7dde2; background: #fff; }
  .brand { font-weight: 700; color: #171a1c; text-decoration: none; }
  main { max-width: 1000px; margin: 0 auto; padding: 26px 22px 60px; }
  h1 { font-size: 1.8rem; margin: 0 0 8px; }
  form { display: grid; gap: 10px; max-width: 520px; }
  .filters { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin: 18px 0; padding: 14px; border: 1px solid #d7dde2; border-radius: 9px; background: #fff; }
  .filters label { display: grid; gap: 4px; font-size: 0.82rem; font-weight: 600; color: #667079; }
  input, select { font: inherit; padding: 8px 9px; border: 1px solid #d7dde2; border-radius: 6px; background: #fff; }
  button, .button { font: inherit; cursor: pointer; display: inline-block; padding: 8px 12px; border: 1px solid #245b78; border-radius: 6px; background: #245b78; color: #fff; text-decoration: none; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d7dde2; border-radius: 9px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #d7dde2; }
  th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: #667079; background: #f1f4f6; }
  .pager { display: flex; gap: 12px; align-items: center; margin-top: 16px; }
  .muted { color: #667079; font-size: 0.9rem; }
  .error { color: #9b2c2c; font-weight: 600; }
  .login { max-width: 380px; margin: 10vh auto; padding: 24px; border: 1px solid #d7dde2; border-radius: 10px; background: #fff; }
`;

function layout(title: string, body: string, email?: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Portolan Support</title><style>${STYLES}</style></head>
<body>
  <header><a class="brand" href="/">Portolan Support</a>${email ? `<span class="muted">${escapeHtml(email)}</span>` : ""}</header>
  <main>${body}</main>
</body>
</html>`;
}

export function loginPage(error?: string, variant: "v1" | "v2" = "v1"): string {
  return layout(
    "Sign in",
    `<section class="login">
       <h1>Sign in</h1>
       <p class="muted">Demo account: agent@example.com / support</p>
       ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
       <form method="post" action="/login">
         <label for="email">${variant === "v2" ? "Work email" : "Email"}</label>
         <input id="email" name="email" type="email" required>
         <label for="password">Password</label>
         <input id="password" name="password" type="password" required>
         <button type="submit" data-testid="login-submit">Sign in</button>
       </form>
     </section>`,
  );
}

function pageHref(page: number, filters: TicketFilters, variant: "v1" | "v2"): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set(variant === "v2" ? "state" : "status", filters.status);
  params.set(variant === "v2" ? "p" : "page", String(page));
  return `/?${params.toString()}`;
}

export function ticketsPage(
  page: { rows: Ticket[]; page: number; pages: number; total: number },
  filters: TicketFilters,
  email: string,
  variant: "v1" | "v2" = "v1",
): string {
  const statusOptions = STATUSES.map(
    (status) =>
      `<option value="${status}" ${filters.status === status ? "selected" : ""}>${status}</option>`,
  ).join("");

  const rows = page.rows
    .map(
      (ticket) => `<tr data-testid="ticket-row">
        <td><a href="/tickets/${ticket.id}">${escapeHtml(ticket.subject)}</a></td>
        <td data-status="${ticket.status}">${escapeHtml(ticket.status)}</td>
        <td>${escapeHtml(ticket.priority)}</td>
        <td>${escapeHtml(ticket.requester)}</td>
      </tr>`,
    )
    .join("");

  return layout(
    "Tickets",
    `<h1>Tickets</h1>
     <p class="muted">${page.total} matching tickets · page ${page.page} of ${page.pages}</p>
     <p><a class="button" href="${variant === "v2" ? "/requests/new" : "/tickets/new"}">${
       variant === "v2" ? "Open request" : "Create ticket"
     }</a></p>
     <form class="filters" method="get" action="/">
       <label>Search <input name="q" value="${escapeHtml(filters.q)}"></label>
       <label>${variant === "v2" ? "Ticket status" : "Status"}
         <select name="${variant === "v2" ? "state" : "status"}">
           <option value="">All</option>
           ${statusOptions}
         </select>
       </label>
       <button type="submit">Filter</button>
     </form>
     <table data-testid="ticket-table">
       <thead><tr><th>Subject</th><th>Status</th><th>Priority</th><th>Requester</th></tr></thead>
       <tbody>${rows || '<tr><td colspan="4">No tickets match.</td></tr>'}</tbody>
     </table>
     <div class="pager">
       ${
         page.page > 1
           ? `<a href="${pageHref(page.page - 1, filters, variant)}" data-testid="page-prev">Previous</a>`
           : ""
       }
       <span class="muted">Page ${page.page} of ${page.pages}</span>
       ${
         page.page < page.pages
           ? `<a href="${pageHref(page.page + 1, filters, variant)}" data-testid="page-next">${
               variant === "v2" ? "Next page" : "Next"
             }</a>`
           : ""
       }
     </div>`,
    email,
  );
}

export function ticketPage(ticket: Ticket, variant: "v1" | "v2" = "v1"): string {
  return layout(
    ticket.subject,
    `<p><a href="/">← Back to tickets</a></p>
     <article data-testid="ticket-detail">
       <h1>${escapeHtml(ticket.subject)}</h1>
       <p class="muted">${escapeHtml(ticket.id)} · ${escapeHtml(ticket.status)} · ${escapeHtml(
         ticket.priority,
       )}</p>
       <p>Requester: ${escapeHtml(ticket.requester)}</p>
       <p data-testid="ticket-id">${escapeHtml(ticket.id)}</p>
       <p class="muted">${variant === "v2" ? "Opened via the support queue." : "Created from the support portal."}</p>
     </article>`,
  );
}

export function newTicketPage(variant: "v1" | "v2" = "v1"): string {
  const priorityOptions = PRIORITIES.map(
    (priority) => `<option value="${priority}">${priority}</option>`,
  ).join("");

  return layout(
    "New ticket",
    `<h1>${variant === "v2" ? "Open a request" : "Create a ticket"}</h1>
     <form data-ticket-form>
       <label for="subject">Subject</label>
       <input id="subject" name="subject" required>
       <label for="priority">${variant === "v2" ? "Urgency" : "Priority"}</label>
       <select id="priority" name="${variant === "v2" ? "urgency" : "priority"}">
         <option value="">Choose one</option>
         ${priorityOptions}
       </select>
       <button type="submit" data-testid="create-ticket">${
         variant === "v2" ? "Open request" : "Create ticket"
       }</button>
     </form>
     <script>
       const form = document.querySelector("[data-ticket-form]");
       form.addEventListener("submit", async (event) => {
         event.preventDefault();
         const data = Object.fromEntries(new FormData(form).entries());
         const response = await fetch("/api/tickets", {
           method: "POST",
           headers: { "content-type": "application/json" },
           body: JSON.stringify(data),
         });
         if (response.ok) {
           const payload = await response.json();
           window.location.href = payload.redirect;
         } else {
           window.alert("Could not create the ticket");
         }
       });
     </script>`,
  );
}

export function errorPage(message: string): string {
  return layout("Something went wrong", `<h1>${escapeHtml(message)}</h1>`);
}
