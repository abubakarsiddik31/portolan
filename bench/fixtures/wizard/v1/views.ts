import type { Submission, WizardData, WizardState } from "./data.js";
import { ROLES } from "./data.js";

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
  :root { color-scheme: light; --ink: #1b1a17; --muted: #6d675c; --line: #d9d2c4; --paper: #f8f5ee; --accent: #3b5f8a; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--paper); }
  header { padding: 18px 24px; border-bottom: 1px solid var(--line); background: #fffdf8; }
  .brand { font-weight: 700; letter-spacing: -0.02em; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 1.9rem; letter-spacing: -0.03em; margin: 0 0 8px; }
  h2 { font-size: 1.1rem; margin: 0 0 8px; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .steps { display: flex; gap: 8px; margin: 20px 0 28px; padding: 0; list-style: none; }
  .steps li { flex: 1; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fffdf8; color: var(--muted); font-size: 0.9rem; }
  .steps li.current { border-color: var(--accent); color: var(--ink); font-weight: 700; }
  .steps li.done { background: #eef2f7; color: var(--ink); }
  form { display: grid; gap: 10px; max-width: 520px; }
  label { font-weight: 600; font-size: 0.9rem; }
  input, select { font: inherit; padding: 9px 10px; border: 1px solid var(--line); border-radius: 7px; background: #fff; }
  fieldset { border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  legend { font-weight: 700; padding: 0 6px; }
  button, .button { font: inherit; cursor: pointer; display: inline-block; padding: 9px 14px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: #fff; text-decoration: none; }
  .error { color: #9b2c2c; font-weight: 600; }
  .review { border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: #fffdf8; }
  .review dl { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; margin: 0; }
  .review dt { color: var(--muted); }
  .review dd { margin: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Portolan Wizard</title>
  <style>${STYLES}</style>
</head>
<body>
  <header><span class="brand">Portolan Wizard</span></header>
  <main>${body}</main>
</body>
</html>`;
}

function stepIndicator(step: 1 | 2 | 3): string {
  const items = [
    { number: 1, label: "About you" },
    { number: 2, label: "Your team" },
    { number: 3, label: "Review and upload" },
  ];
  return `<ol class="steps" data-testid="steps">${items
    .map(
      (item) =>
        `<li class="${item.number === step ? "current" : item.number < step ? "done" : ""}">${item.number}. ${item.label}</li>`,
    )
    .join("")}</ol>`;
}

function errorsBlock(errors: Record<string, string>): string {
  const entries = Object.values(errors);
  if (entries.length === 0) return "";
  return `<div class="error" role="alert" data-testid="errors">${entries
    .map((message) => `<p>${escapeHtml(message)}</p>`)
    .join("")}</div>`;
}

export function step1Page(
  state: WizardState,
  errors: Record<string, string> = {},
  variant: "v1" | "v2" = "v1",
): string {
  return layout(
    "About you",
    `<h1>Tell us about you</h1>
     <p class="muted">Step 1 of 3</p>
     ${stepIndicator(1)}
     ${errorsBlock(errors)}
     <form method="post" action="${variant === "v2" ? "/apply/1" : "/step/1"}" novalidate>
       <label for="name">${variant === "v2" ? "Name" : "Full name"}</label>
       <input id="name" name="name" value="${escapeHtml(state.data.name ?? "")}" required>
       <label for="email">${variant === "v2" ? "Email" : "Work email"}</label>
       <input id="email" name="email" type="email" value="${escapeHtml(state.data.email ?? "")}" required>
       <button type="submit" data-testid="step1-next">Continue</button>
     </form>`,
  );
}

export function step2Page(
  state: WizardState,
  errors: Record<string, string> = {},
  variant: "v1" | "v2" = "v1",
): string {
  const options = ROLES.map(
    (role) =>
      `<option value="${escapeHtml(role)}" ${state.data.role === role ? "selected" : ""}>${escapeHtml(role)}</option>`,
  ).join("");
  return layout(
    "Your team",
    `<h1>Tell us about your team</h1>
     <p class="muted">Step 2 of 3</p>
     ${stepIndicator(2)}
     ${errorsBlock(errors)}
     <form method="post" action="${variant === "v2" ? "/apply/2" : "/step/2"}" novalidate>
       <label for="company">${variant === "v2" ? "Employer" : "Company"}</label>
       <input id="company" name="company" value="${escapeHtml(state.data.company ?? "")}" required>
       <label for="role">${variant === "v2" ? "Role" : "Your role"}</label>
       <select id="role" name="role" required>
         <option value="">Choose a role</option>
         ${options}
       </select>
       <label for="teamSize">Team size</label>
       <input id="teamSize" name="teamSize" type="number" min="1" max="1000" value="${state.data.teamSize ?? ""}" required>
       <button type="submit" data-testid="step2-next">Continue</button>
     </form>`,
  );
}

export function step3Page(
  state: WizardState,
  errors: Record<string, string> = {},
  variant: "v1" | "v2" = "v1",
): string {
  const data = state.data as Partial<WizardData>;
  return layout(
    "Review and upload",
    `<h1>Review and upload</h1>
     <p class="muted">Step 3 of 3</p>
     ${stepIndicator(3)}
     ${errorsBlock(errors)}
     <section class="review" data-testid="review">
       <h2>Your answers</h2>
       <dl>
         <dt>Name</dt><dd>${escapeHtml(data.name ?? "")}</dd>
         <dt>Email</dt><dd>${escapeHtml(data.email ?? "")}</dd>
         <dt>Company</dt><dd>${escapeHtml(data.company ?? "")}</dd>
         <dt>Role</dt><dd>${escapeHtml(data.role ?? "")}</dd>
         <dt>Team size</dt><dd>${escapeHtml(String(data.teamSize ?? ""))}</dd>
       </dl>
     </section>
     <form method="post" action="${variant === "v2" ? "/apply/submit" : "/submit"}" enctype="multipart/form-data" novalidate>
       <label for="attachment">${variant === "v2" ? "Attach a file" : "Attachment (PDF, TXT or PNG, max 1 MB)"}</label>
       <input id="attachment" name="attachment" type="file" accept=".pdf,.txt,.png" required>
       <label>
         <input type="checkbox" name="terms" required>
         I confirm the details above are correct.
       </label>
       <button type="submit" data-testid="submit-application">Submit application</button>
     </form>`,
  );
}

export function donePage(submission: Submission, variant: "v1" | "v2" = "v1"): string {
  return layout(
    "Application received",
    `<h1>Application received</h1>
     <p>Reference <strong data-testid="submission-id" data-submission-id="${submission.id}">${submission.id}</strong></p>
     <p class="muted">Attached: ${escapeHtml(submission.fileName)} (${submission.fileSize} bytes)</p>
     <p><a class="button" href="${variant === "v2" ? "/apply/1" : "/step/1"}">Start another application</a></p>`,
  );
}

export function errorPage(message: string): string {
  return layout("Something went wrong", `<h1>${escapeHtml(message)}</h1>`);
}
