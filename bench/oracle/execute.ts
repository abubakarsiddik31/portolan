import type { Page } from "playwright-core";
import { z } from "zod";

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
  viewCart,
} from "./index.js";
import type { Site } from "./sites.js";

const statusSchema = z.enum(["paid", "pending", "overdue"]);

const storeSchemas = {
  search: z.object({ query: z.string().min(1) }),
  get_product: z.object({ product_id: z.string().min(1) }),
  add_to_cart: z.object({
    product_id: z.string().min(1),
    variant_id: z.string().min(1),
    qty: z.number().int().min(1).max(10),
  }),
  view_cart: z.object({}),
  checkout: z.object({
    name: z.string().min(1),
    email: z.string().min(1),
    address: z.string().min(1),
    city: z.string().min(1),
    postal: z.string().min(1),
    card: z.string().min(1),
  }),
};

const wizardSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  team_size: z.number().int().min(1),
  file_path: z.string().min(1),
});

const portalSchemas = {
  login: z.object({ email: z.string().min(1), password: z.string().min(1) }),
  filter_invoices: z.object({ status: statusSchema }),
  paginate: z.object({ page: z.number().int().min(1) }),
  export_csv: z.object({ status: statusSchema }),
};

export async function executeOp(
  site: Site,
  op: string,
  params: unknown,
  page: Page,
): Promise<unknown> {
  if (site === "store") {
    switch (op) {
      case "search": {
        const parsed = storeSchemas.search.parse(params);
        return search(page, parsed.query);
      }
      case "get_product": {
        const parsed = storeSchemas.get_product.parse(params);
        return getProduct(page, parsed.product_id);
      }
      case "add_to_cart": {
        const parsed = storeSchemas.add_to_cart.parse(params);
        return addToCart(page, {
          productId: parsed.product_id,
          variantId: parsed.variant_id,
          qty: parsed.qty,
        });
      }
      case "view_cart": {
        storeSchemas.view_cart.parse(params);
        return viewCart(page);
      }
      case "checkout": {
        const parsed = storeSchemas.checkout.parse(params);
        return checkout(page, parsed);
      }
      default:
        throw new Error(`unknown store op "${op}"`);
    }
  }

  if (site === "wizard") {
    const parsed = wizardSchema.parse(params);
    const application = {
      name: parsed.name,
      email: parsed.email,
      company: parsed.company,
      role: parsed.role,
      teamSize: parsed.team_size,
    };

    switch (op) {
      case "submit_application":
        return submitApplication(page, application, parsed.file_path);
      case "submit_with_recovery":
        return submitWithRecovery(page, application, parsed.file_path);
      default:
        throw new Error(`unknown wizard op "${op}"`);
    }
  }

  switch (op) {
    case "login": {
      const parsed = portalSchemas.login.parse(params);
      await login(page, parsed);
      return { ok: true };
    }
    case "filter_invoices": {
      const parsed = portalSchemas.filter_invoices.parse(params);
      return filterInvoices(page, parsed.status);
    }
    case "paginate": {
      const parsed = portalSchemas.paginate.parse(params);
      return paginate(page, parsed.page);
    }
    case "export_csv": {
      const parsed = portalSchemas.export_csv.parse(params);
      return exportCsv(page, parsed.status);
    }
    default:
      throw new Error(`unknown portal op "${op}"`);
  }
}
