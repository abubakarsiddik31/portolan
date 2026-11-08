import type { Page } from "playwright-core";

import type { Cart, Customer, Order, ProductDetail, StoreProduct } from "./types.js";

export async function search(page: Page, query: string): Promise<StoreProduct[]> {
  await page.goto("/");
  await page.getByLabel("Search products").fill(query);
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/\/search\?q=/);

  return page.locator('[data-testid="product-card"]').evaluateAll((cards) =>
    cards.map((card) => ({
      id: card.querySelector("h2 a")?.getAttribute("href")?.split("/").pop() ?? "",
      name: card.querySelector("h2")?.textContent?.trim() ?? "",
      price: card.querySelector(".price")?.textContent?.trim() ?? "",
    })),
  );
}

export async function getProduct(page: Page, id: string): Promise<ProductDetail> {
  await page.goto(`/p/${id}`);
  const name = (await page.locator("h1").textContent())?.trim() ?? "";
  const price = (await page.locator(".price").first().textContent())?.trim() ?? "";
  const variants = await page
    .locator("#variant option")
    .evaluateAll((options) => options.map((option) => option.getAttribute("value") ?? ""));

  return { id, name, price, variants };
}

export async function viewCart(page: Page): Promise<Cart> {
  await page.goto("/cart");
  const items = await page.locator('[data-testid="cart-row"]').evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector("td a")?.textContent?.trim() ?? "",
      qty: Number(row.querySelector('input[name="qty"]')?.getAttribute("value") ?? "0"),
      total: row.querySelector("td:last-child")?.textContent?.trim() ?? "",
    })),
  );
  const subtotal =
    (await page.locator('[data-testid="cart-subtotal"]').textContent())?.trim() ?? "";

  return { items, subtotal, count: items.reduce((sum, item) => sum + item.qty, 0) };
}

export async function addToCart(
  page: Page,
  input: { productId: string; variantId: string; qty: number },
): Promise<Cart> {
  await page.goto(`/p/${input.productId}`);
  await page.getByLabel("Size / color").selectOption(input.variantId);
  await page.getByLabel("Quantity").fill(String(input.qty));
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForURL(/\/cart$/);
  return viewCart(page);
}

export async function checkout(page: Page, customer: Customer): Promise<Order> {
  await page.goto("/checkout");
  await page.getByLabel("Full name").fill(customer.name);
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Address").fill(customer.address);
  await page.getByLabel("City").fill(customer.city);
  await page.getByLabel("Postal code").fill(customer.postal);
  await page.getByLabel("Card number").fill(customer.card);
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/orders\/ord_\d+$/);

  const orderId = await page.locator("[data-order-id]").getAttribute("data-order-id");
  if (!orderId) throw new Error("order id missing from confirmation");
  return { orderId };
}
