/**
 * Live MCP smoke: connect as a coding tool would, over stdio.
 *
 * Start the three fixtures on 4100/4101/4102 and run `pnpm build` first.
 * The script drives a store purchase, a portal filter/export and a wizard
 * upload through the portable list_sites / open_site / call surface.
 */

import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = Object.fromEntries(
  Object.entries({
    ...process.env,
    STORE_URL: "http://127.0.0.1:4100",
    WIZARD_URL: "http://127.0.0.1:4101",
    PORTAL_URL: "http://127.0.0.1:4102",
  }).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

const transport = new StdioClientTransport({
  command: "node",
  args: [join(import.meta.dirname, "../dist/oracle/main.js")],
  env,
});

const client = new Client({ name: "coding-tool-smoke", version: "0.0.1" });
await client.connect(transport);

function textOf(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      typeof item === "object" && item !== null && "text" in item
        ? String((item as { text: unknown }).text)
        : "",
    )
    .join("\n");
}

let failures = 0;

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const ms = Math.round(performance.now() - started);
  const text = textOf(result);
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // plain text is fine
  }
  const ok =
    typeof parsed === "object" && parsed !== null && "ok" in parsed
      ? (parsed as { ok?: boolean }).ok !== false
      : !(result as { isError?: boolean }).isError;
  if (!ok) failures += 1;
  console.log(`\n### ${name} ${ok ? "OK" : "FAIL"} (${ms}ms)`);
  console.log(text.slice(0, 900));
  return parsed;
}

await call("list_sites", {});
await call("open_site", { site: "store" });
await call("call", { op: "search", params: { query: "tee" } });
await call("call", { op: "get_product", params: { product_id: "p_101" } });
await call("call", {
  op: "add_to_cart",
  params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
});
await call("call", { op: "view_cart", params: {} });
const order = await call("call", {
  op: "checkout",
  params: {
    name: "Ada Lovelace",
    email: "ada@example.com",
    address: "1 Analytical Way",
    city: "London",
    postal: "N1 1AA",
    card: "4242424242424242",
  },
});
console.log("\nORDER RESULT:", JSON.stringify(order));

await call("open_site", { site: "portal" });
await call("call", {
  op: "login",
  params: { email: "analyst@example.com", password: "portolan" },
});
await call("call", { op: "filter_invoices", params: { status: "overdue" } });
await call("call", { op: "paginate", params: { page: 2 } });
const exported = await call("call", { op: "export_csv", params: { status: "paid" } });
console.log("\nEXPORT RESULT:", JSON.stringify(exported).slice(0, 400));

await call("open_site", { site: "wizard" });
const submission = await call("call", {
  op: "submit_application",
  params: {
    name: "Ada Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    role: "Engineer",
    team_size: 12,
    file_path: join(import.meta.dirname, "../tasks/files/sample.txt"),
  },
});
console.log("\nSUBMISSION RESULT:", JSON.stringify(submission));

await client.close();
console.log(`\n=== ${failures === 0 ? "ALL OPS OK" : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
