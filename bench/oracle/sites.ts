export type Effect = "read" | "write" | "irreversible";

export type OpInfo = {
  name: string;
  signature: string;
  summary: string;
  effect: Effect;
};

export type SiteInfo = {
  description: string;
  ops: OpInfo[];
};

export const SITES = {
  store: {
    description: "A small store: search, product, cart, checkout.",
    ops: [
      { name: "search", signature: "query", summary: "Search products.", effect: "read" },
      {
        name: "get_product",
        signature: "product_id",
        summary: "Read a product and its variants.",
        effect: "read",
      },
      {
        name: "add_to_cart",
        signature: "product_id, variant_id, qty",
        summary: "Add a variant to the cart.",
        effect: "write",
      },
      { name: "view_cart", signature: "", summary: "Read the cart.", effect: "read" },
      {
        name: "checkout",
        signature: "name, email, address, city, postal, card",
        summary: "Place an order.",
        effect: "irreversible",
      },
    ],
  },
  wizard: {
    description: "A three-step application with validation and an upload.",
    ops: [
      {
        name: "submit_application",
        signature: "name, email, company, role, team_size, file_path",
        summary: "Complete the application.",
        effect: "write",
      },
      {
        name: "submit_with_recovery",
        signature: "name, email, company, role, team_size, file_path",
        summary: "Fail validation once, then complete.",
        effect: "write",
      },
    ],
  },
  portal: {
    description: "A login-gated invoice ledger with filter, pagination and CSV export.",
    ops: [
      { name: "login", signature: "email, password", summary: "Sign in.", effect: "write" },
      {
        name: "filter_invoices",
        signature: "status",
        summary: "Filter invoices by status.",
        effect: "read",
      },
      { name: "paginate", signature: "page", summary: "Open an invoice page.", effect: "read" },
      {
        name: "export_csv",
        signature: "status",
        summary: "Export filtered invoices as CSV.",
        effect: "read",
      },
    ],
  },
} as const satisfies Record<string, SiteInfo>;

export type Site = keyof typeof SITES;

export function renderMap(site: Site): string {
  const info = SITES[site];
  const lines = info.ops.map((op) => {
    const call = `${op.name}(${op.signature})`;
    return `  ${call.padEnd(46)}${op.summary} [${op.effect}]`;
  });
  return `${site} · oracle map\n${info.description}\n${lines.join("\n")}`;
}
