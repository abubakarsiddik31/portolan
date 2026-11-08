import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "./app.js";

let app: FastifyInstance;

const cookie = (sid: string) => ({ cookie: `sid=${sid}` });
const json = (sid: string) => ({ ...cookie(sid), "content-type": "application/json" });
const form = (sid: string) => ({
  ...cookie(sid),
  "content-type": "application/x-www-form-urlencoded",
});

const validCheckout = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  address: "1 Analytical Way",
  city: "London",
  postal: "N1 1AA",
  card: "4242424242424242",
};

beforeAll(async () => {
  app = await buildStoreApp();
});

afterAll(async () => {
  await app.close();
});

describe("store fixture v1", () => {
  it("serves the catalog", async () => {
    const response = await app.inject({ method: "GET", url: "/", headers: cookie("catalog") });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Everyday Tee");
    expect(response.body).toContain("Field Jacket");
  });

  it("filters the catalog by search", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/search?q=socks",
      headers: cookie("search"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Merino Socks");
    expect(response.body).not.toContain("Field Jacket");
  });

  it("renders a product with its variants", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/p/p_101",
      headers: cookie("product"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Everyday Tee");
    expect(response.body).toContain("v_101_m_blue");
  });

  it("adds a variant to the cart over JSON", async () => {
    const sid = "add-json";
    const add = await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: json(sid),
      payload: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 2 },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json()).toMatchObject({ ok: true, cart_count: 2, redirect: "/cart" });

    const cart = await app.inject({ method: "GET", url: "/cart", headers: cookie(sid) });
    expect(cart.body).toContain("Everyday Tee");
    expect(cart.body).toContain('value="2"');
  });

  it("adds a variant to the cart over a form", async () => {
    const add = await app.inject({
      method: "POST",
      url: "/cart/add",
      headers: form("add-form"),
      payload: "product_id=p_102&variant_id=v_102_one_size_natural&qty=1",
    });
    expect(add.statusCode).toBe(303);
    expect(add.headers.location).toBe("/cart");
  });

  it("updates and removes a cart line", async () => {
    const sid = "update";
    await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: json(sid),
      payload: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
    });

    await app.inject({
      method: "POST",
      url: "/cart/update",
      headers: form(sid),
      payload: "variant_id=v_101_m_blue&qty=3",
    });
    const updated = await app.inject({ method: "GET", url: "/cart", headers: cookie(sid) });
    expect(updated.body).toContain('value="3"');

    await app.inject({
      method: "POST",
      url: "/cart/remove",
      headers: form(sid),
      payload: "variant_id=v_101_m_blue",
    });
    const empty = await app.inject({ method: "GET", url: "/cart", headers: cookie(sid) });
    expect(empty.body).toContain("cart-empty");
  });

  it("checks out and exposes an observable order id", async () => {
    const sid = "checkout";
    await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: json(sid),
      payload: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 2 },
    });

    const checkout = await app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: json(sid),
      payload: validCheckout,
    });
    expect(checkout.statusCode).toBe(200);

    const body = checkout.json();
    expect(body.order_id).toMatch(/^ord_\d+$/);
    expect(body.redirect).toBe(`/orders/${body.order_id}`);

    const order = await app.inject({
      method: "GET",
      url: body.redirect,
      headers: cookie(sid),
    });
    expect(order.body).toContain(`data-order-id="${body.order_id}"`);

    const list = await app.inject({ method: "GET", url: "/api/orders", headers: cookie(sid) });
    expect(list.json().orders[0].id).toBe(body.order_id);
  });

  it("rejects an invalid checkout with field errors", async () => {
    const sid = "invalid";
    await app.inject({
      method: "POST",
      url: "/api/cart/items",
      headers: json(sid),
      payload: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: json(sid),
      payload: { ...validCheckout, email: "not-an-email", card: "123" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: "invalid_checkout" });
    expect(response.json().fields.email).toBeTruthy();
    expect(response.json().fields.card).toBeTruthy();
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ ok: true, fixture: "store", version: "v1" });
  });
});
