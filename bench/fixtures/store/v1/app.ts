import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";

import {
  type Cart,
  type Customer,
  findProduct,
  findVariant,
  type Order,
  products,
  searchProducts,
} from "./data.js";
import {
  type CartLineView,
  type CartView,
  cartPage,
  catalogPage,
  checkoutPage,
  errorPage,
  orderPage,
  ordersPage,
  productPage,
} from "./views.js";

declare module "fastify" {
  interface FastifyRequest {
    sid: string;
  }
}

type AddResult = { ok: true; cart: CartView } | { ok: false; error: string };
type OrderResult = { ok: true; order: Order } | { ok: false; error: string };
type CustomerResult =
  | { ok: true; customer: Customer }
  | { ok: false; fields: Record<string, string> };

function parseQty(value: unknown, fallback = 1): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readCustomer(body: Record<string, unknown>): CustomerResult {
  const text = (key: string): string =>
    typeof body[key] === "string" ? (body[key] as string).trim() : "";

  const name = text("name");
  const email = text("email");
  const address = text("address");
  const city = text("city");
  const postal = text("postal");
  const card = text("card").replace(/\s+/g, "");
  const fields: Record<string, string> = {};

  if (!name) fields.name = "Enter your full name";
  if (!email) fields.email = "Enter your email";
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = "Enter a valid email";
  if (!address) fields.address = "Enter your address";
  if (!city) fields.city = "Enter your city";
  if (!postal) fields.postal = "Enter your postal code";
  if (!card) fields.card = "Enter a card number";
  else if (!/^\d{16}$/.test(card)) fields.card = "Enter a 16-digit card number";

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, customer: { name, email, address, city, postal } };
}

export async function buildStoreApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await app.register(formbody);

  const carts = new Map<string, Cart>();
  const orders = new Map<string, Order>();
  let orderSeq = 1001;

  app.addHook("preHandler", async (request, reply) => {
    const existing = request.cookies.sid;
    if (existing) {
      request.sid = existing;
      return;
    }
    const sid = randomUUID();
    reply.setCookie("sid", sid, { path: "/", httpOnly: true, sameSite: "lax" });
    request.sid = sid;
  });

  const cartFor = (sid: string): Cart => {
    const existing = carts.get(sid);
    if (existing) return existing;
    const cart: Cart = { items: [] };
    carts.set(sid, cart);
    return cart;
  };

  const viewCart = (cart: Cart): CartView => {
    const lines: CartLineView[] = [];
    for (const item of cart.items) {
      const found = findVariant(item.productId, item.variantId);
      if (!found) continue;
      lines.push({
        product: found.product,
        variant: found.variant,
        qty: item.qty,
        lineCents: found.product.priceCents * item.qty,
      });
    }
    return {
      lines,
      subtotalCents: lines.reduce((sum, line) => sum + line.lineCents, 0),
      count: lines.reduce((sum, line) => sum + line.qty, 0),
    };
  };

  const addToCart = (sid: string, productId: string, variantId: string, qty: number): AddResult => {
    const found = findVariant(productId, variantId);
    if (!found) return { ok: false, error: "unknown_variant" };
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      return { ok: false, error: "invalid_quantity" };
    }
    if (found.variant.stock < qty) return { ok: false, error: "out_of_stock" };

    const cart = cartFor(sid);
    const existing = cart.items.find((item) => item.variantId === variantId);
    if (existing) existing.qty = Math.min(10, existing.qty + qty);
    else cart.items.push({ productId, variantId, qty });
    return { ok: true, cart: viewCart(cart) };
  };

  const updateCart = (sid: string, variantId: string, qty: number): void => {
    const cart = cartFor(sid);
    const item = cart.items.find((candidate) => candidate.variantId === variantId);
    if (!item) return;
    if (qty <= 0) {
      cart.items = cart.items.filter((candidate) => candidate.variantId !== variantId);
      return;
    }
    const found = findVariant(item.productId, variantId);
    const max = Math.min(10, found?.variant.stock ?? 10);
    item.qty = Math.max(1, Math.min(qty, max));
  };

  const removeFromCart = (sid: string, variantId: string): void => {
    const cart = cartFor(sid);
    cart.items = cart.items.filter((candidate) => candidate.variantId !== variantId);
  };

  const createOrder = (sid: string, customer: Customer): OrderResult => {
    const cart = cartFor(sid);
    const view = viewCart(cart);
    if (view.lines.length === 0) return { ok: false, error: "empty_cart" };
    for (const line of view.lines) {
      if (line.qty > line.variant.stock) return { ok: false, error: "out_of_stock" };
    }

    const order: Order = {
      id: `ord_${orderSeq++}`,
      sid,
      items: cart.items.map((item) => ({ ...item })),
      totalCents: view.subtotalCents,
      customer,
      createdAt: new Date().toISOString(),
    };
    orders.set(order.id, order);
    carts.delete(sid);
    return { ok: true, order };
  };

  app.get("/health", async () => ({ ok: true, fixture: "store", version: "v1" }));

  app.get("/", async (request, reply) => {
    const cart = viewCart(cartFor(request.sid));
    return reply.type("text/html").send(catalogPage(products, "", cart.count));
  });

  app.get<{ Querystring: { q?: string } }>("/search", async (request, reply) => {
    const query = request.query.q ?? "";
    const cart = viewCart(cartFor(request.sid));
    return reply.type("text/html").send(catalogPage(searchProducts(query), query, cart.count));
  });

  app.get<{ Params: { id: string } }>("/p/:id", async (request, reply) => {
    const product = findProduct(request.params.id);
    if (!product) {
      return reply.code(404).type("text/html").send(errorPage("Product not found"));
    }
    const cart = viewCart(cartFor(request.sid));
    return reply.type("text/html").send(productPage(product, cart.count));
  });

  app.post<{ Body: { product_id?: string; variant_id?: string; qty?: string } }>(
    "/cart/add",
    async (request, reply) => {
      const productId = request.body.product_id ?? "";
      const result = addToCart(
        request.sid,
        productId,
        request.body.variant_id ?? "",
        parseQty(request.body.qty),
      );
      if (!result.ok) {
        const product = findProduct(productId);
        const cart = viewCart(cartFor(request.sid));
        if (product) {
          return reply
            .code(400)
            .type("text/html")
            .send(productPage(product, cart.count, result.error));
        }
        return reply
          .code(400)
          .type("text/html")
          .send(errorPage("Could not add to cart", cart.count));
      }
      return reply.code(303).redirect("/cart");
    },
  );

  app.post<{ Body: { product_id?: string; variant_id?: string; qty?: number } }>(
    "/api/cart/items",
    async (request, reply) => {
      const result = addToCart(
        request.sid,
        request.body.product_id ?? "",
        request.body.variant_id ?? "",
        parseQty(request.body.qty),
      );
      if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
      return {
        ok: true,
        cart_count: result.cart.count,
        subtotal_cents: result.cart.subtotalCents,
        redirect: "/cart",
      };
    },
  );

  app.get("/cart", async (request, reply) => {
    const cart = viewCart(cartFor(request.sid));
    return reply.type("text/html").send(cartPage(cart, cart.count));
  });

  app.post<{ Body: { variant_id?: string; qty?: string } }>(
    "/cart/update",
    async (request, reply) => {
      updateCart(request.sid, request.body.variant_id ?? "", parseQty(request.body.qty));
      return reply.code(303).redirect("/cart");
    },
  );

  app.post<{ Body: { variant_id?: string } }>("/cart/remove", async (request, reply) => {
    removeFromCart(request.sid, request.body.variant_id ?? "");
    return reply.code(303).redirect("/cart");
  });

  app.get("/checkout", async (request, reply) => {
    const cart = viewCart(cartFor(request.sid));
    if (cart.lines.length === 0) return reply.code(303).redirect("/cart");
    return reply.type("text/html").send(checkoutPage(cart, cart.count));
  });

  app.post<{ Body: Record<string, unknown> }>("/checkout", async (request, reply) => {
    const cart = viewCart(cartFor(request.sid));
    if (cart.lines.length === 0) return reply.code(303).redirect("/cart");

    const customer = readCustomer(request.body);
    if (!customer.ok) {
      return reply
        .code(400)
        .type("text/html")
        .send(checkoutPage(cart, cart.count, customer.fields));
    }

    const result = createOrder(request.sid, customer.customer);
    if (!result.ok) {
      return reply
        .code(400)
        .type("text/html")
        .send(checkoutPage(cart, cart.count, { form: result.error }));
    }
    return reply.code(303).redirect(`/orders/${result.order.id}`);
  });

  app.post<{ Body: Record<string, unknown> }>("/api/checkout", async (request, reply) => {
    const cart = viewCart(cartFor(request.sid));
    if (cart.lines.length === 0) return reply.code(400).send({ ok: false, error: "empty_cart" });

    const customer = readCustomer(request.body);
    if (!customer.ok) {
      return reply
        .code(400)
        .send({ ok: false, error: "invalid_checkout", fields: customer.fields });
    }

    const result = createOrder(request.sid, customer.customer);
    if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });

    return {
      ok: true,
      order_id: result.order.id,
      total_cents: result.order.totalCents,
      redirect: `/orders/${result.order.id}`,
    };
  });

  app.get("/orders", async (request, reply) => {
    const list = [...orders.values()]
      .filter((order) => order.sid === request.sid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const cart = viewCart(cartFor(request.sid));
    return reply.type("text/html").send(ordersPage(list, cart.count));
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const order = orders.get(request.params.id);
    const cart = viewCart(cartFor(request.sid));
    if (!order || order.sid !== request.sid) {
      return reply.code(404).type("text/html").send(errorPage("Order not found", cart.count));
    }
    return reply.type("text/html").send(orderPage(order, cart.count));
  });

  app.get<{ Querystring: { q?: string } }>("/api/products", async (request) => ({
    products: searchProducts(request.query.q ?? "").map((product) => ({
      id: product.id,
      name: product.name,
      price_cents: product.priceCents,
      url: `/p/${product.id}`,
    })),
  }));

  app.get<{ Params: { id: string } }>("/api/products/:id", async (request, reply) => {
    const product = findProduct(request.params.id);
    if (!product) return reply.code(404).send({ error: "unknown_product" });
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price_cents: product.priceCents,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        size: variant.size,
        color: variant.color,
        stock: variant.stock,
      })),
    };
  });

  app.get("/api/orders", async (request) => ({
    orders: [...orders.values()]
      .filter((order) => order.sid === request.sid)
      .map((order) => ({
        id: order.id,
        total_cents: order.totalCents,
        created_at: order.createdAt,
      })),
  }));

  return app;
}
