import { existsSync } from "node:fs";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { buildWizardApp } from "../fixtures/wizard/v1/app.js";
import {
  addToCart,
  checkout,
  exportCsv,
  filterInvoices,
  getProduct,
  login,
  paginate,
  search,
  submitApplication,
  submitWithRecovery,
} from "./index.js";

const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(chromePath);

let browser: Browser;
let storeApp: FastifyInstance;
let wizardApp: FastifyInstance;
let portalApp: FastifyInstance;

function portOf(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("fixture has no TCP address");
  return address.port;
}

async function withPage(baseURL: string, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}

const sampleFile = join(process.cwd(), "bench/tasks/files/sample.txt");

const customer = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  address: "1 Analytical Way",
  city: "London",
  postal: "N1 1AA",
  card: "4242424242424242",
};

const application = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  role: "Engineer",
  teamSize: 12,
};

beforeAll(async () => {
  storeApp = await buildStoreApp();
  wizardApp = await buildWizardApp();
  portalApp = await buildPortalApp();
  await Promise.all([
    storeApp.listen({ port: 0, host: "127.0.0.1" }),
    wizardApp.listen({ port: 0, host: "127.0.0.1" }),
    portalApp.listen({ port: 0, host: "127.0.0.1" }),
  ]);
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await storeApp?.close();
  await wizardApp?.close();
  await portalApp?.close();
});

describe.skipIf(!hasChrome)("oracle ops", () => {
  it("searches the store and reads a product", async () => {
    await withPage(`http://127.0.0.1:${portOf(storeApp)}`, async (page) => {
      const products = await search(page, "socks");
      expect(products.map((product) => product.name)).toContain("Merino Socks");

      const product = await getProduct(page, "p_101");
      expect(product.name).toBe("Everyday Tee");
      expect(product.variants).toContain("v_101_m_blue");
    });
  });

  it("adds to the cart and checks out", async () => {
    await withPage(`http://127.0.0.1:${portOf(storeApp)}`, async (page) => {
      const cart = await addToCart(page, {
        productId: "p_101",
        variantId: "v_101_m_blue",
        qty: 2,
      });
      expect(cart.count).toBe(2);
      expect(cart.subtotal).toBe("$48.00");

      const order = await checkout(page, customer);
      expect(order.orderId).toMatch(/^ord_\d+$/);
    });
  });

  it("submits the wizard application with an upload", async () => {
    await withPage(`http://127.0.0.1:${portOf(wizardApp)}`, async (page) => {
      const submission = await submitApplication(page, application, sampleFile);
      expect(submission.submissionId).toMatch(/^sub_\d+$/);
    });
  });

  it("recovers from a validation error in the wizard", async () => {
    await withPage(`http://127.0.0.1:${portOf(wizardApp)}`, async (page) => {
      const submission = await submitWithRecovery(page, application, sampleFile);
      expect(submission.submissionId).toMatch(/^sub_\d+$/);
    });
  });

  it("logs in and filters the ledger", async () => {
    await withPage(`http://127.0.0.1:${portOf(portalApp)}`, async (page) => {
      await login(page, { email: "analyst@example.com", password: "portolan" });
      const rows = await filterInvoices(page, "overdue");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.status === "overdue")).toBe(true);
    });
  });

  it("paginates the ledger", async () => {
    await withPage(`http://127.0.0.1:${portOf(portalApp)}`, async (page) => {
      await login(page, { email: "analyst@example.com", password: "portolan" });
      const rows = await paginate(page, 2);
      expect(rows[0]?.id).toBe("inv_1011");
    });
  });

  it("exports a filtered CSV", async () => {
    await withPage(`http://127.0.0.1:${portOf(portalApp)}`, async (page) => {
      await login(page, { email: "analyst@example.com", password: "portolan" });
      const result = await exportCsv(page, "paid");
      expect(result.filename).toBe("invoices.csv");
      expect(result.content).toContain("inv_1001");
      expect(result.content).not.toContain("inv_1002");
    });
  });
});
