import type { Order, Product, Variant } from "./data.js";
import { findVariant, formatPrice } from "./data.js";

export type CartLineView = {
  product: Product;
  variant: Variant;
  qty: number;
  lineCents: number;
};

export type CartView = {
  lines: CartLineView[];
  subtotalCents: number;
  count: number;
};

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
  :root { color-scheme: light; --ink: #1c1b18; --muted: #6b675f; --line: #d8d2c6; --paper: #faf7f0; --accent: #2f5d50; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--paper); }
  header.site-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px 24px; border-bottom: 1px solid var(--line); background: #fffdf8; }
  .brand { font-weight: 700; letter-spacing: -0.02em; color: var(--ink); text-decoration: none; }
  nav { display: flex; gap: 18px; }
  nav a { color: var(--ink); text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 2rem; letter-spacing: -0.03em; margin: 0 0 20px; }
  h2 { font-size: 1.1rem; margin: 0 0 6px; }
  a { color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; }
  .card { background: #fffdf8; border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  .card h2 a { text-decoration: none; }
  .price { font-weight: 700; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .error { color: #9b2c2c; font-weight: 600; }
  form { display: grid; gap: 10px; max-width: 520px; }
  form.inline { display: inline-flex; align-items: center; gap: 6px; margin-right: 6px; }
  label { font-weight: 600; font-size: 0.9rem; }
  input, select { font: inherit; padding: 9px 10px; border: 1px solid var(--line); border-radius: 7px; background: #fff; }
  button, .button { font: inherit; cursor: pointer; display: inline-block; padding: 9px 14px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: #fff; text-decoration: none; }
  button.link { background: none; border: none; color: var(--accent); padding: 0; }
  table { width: 100%; border-collapse: collapse; margin: 18px 0; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .total { font-size: 1.15rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
`;

function layout(title: string, body: string, cartCount: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Portolan Store</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">Portolan Store</a>
    <nav>
      <a href="/">Catalog</a>
      <a href="/orders">Orders</a>
      <a href="/cart" data-testid="cart-link">Cart <span data-testid="cart-count">${cartCount}</span></a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

export function catalogPage(
  products: Product[],
  query: string,
  cartCount: number,
  variant: "v1" | "v2" = "v1",
): string {
  const cards = products
    .map(
      (product) => `<article class="card" data-testid="product-card">
        <h2><a href="/p/${product.id}">${escapeHtml(product.name)}</a></h2>
        <p class="muted">${escapeHtml(product.description)}</p>
        <p class="price">${formatPrice(product.priceCents)}</p>
        <p class="muted">${product.variants.length} variant${product.variants.length === 1 ? "" : "s"}</p>
      </article>`,
    )
    .join("");

  const heading = query ? `Results for “${escapeHtml(query)}”` : "Catalog";
  return layout(
    query ? `Search: ${query}` : "Catalog",
    `<h1>${heading}</h1>
     <form method="get" action="${variant === "v2" ? "/catalog" : "/search"}" role="search">
       <label for="q">${variant === "v2" ? "Find products" : "Search products"}</label>
       <input id="q" name="q" value="${escapeHtml(query)}" placeholder="tee, socks, mug">
       <button type="submit">${variant === "v2" ? "Find" : "Search"}</button>
     </form>
     <section class="grid" data-testid="product-grid">
       ${cards || "<p>No products found.</p>"}
     </section>`,
    cartCount,
  );
}

export function productPage(
  product: Product,
  cartCount: number,
  error?: string,
  variant: "v1" | "v2" = "v1",
): string {
  const options = product.variants
    .map(
      (variant) =>
        `<option value="${variant.id}">${escapeHtml(variant.size)} / ${escapeHtml(
          variant.color,
        )} — ${formatPrice(product.priceCents)}</option>`,
    )
    .join("");

  return layout(
    product.name,
    `<p><a href="/">← Back to catalog</a></p>
     <article class="product" data-testid="product-detail">
       <h1>${escapeHtml(product.name)}</h1>
       <p>${escapeHtml(product.description)}</p>
       <p class="price">${formatPrice(product.priceCents)}</p>
       ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
       <form method="post" action="/cart/add" data-add-form>
         <input type="hidden" name="product_id" value="${product.id}">
         <label for="variant">${variant === "v2" ? "Size and color" : "Size / color"}</label>
         <select id="variant" name="variant_id" required>${options}</select>
         <label for="qty">Quantity</label>
         <input id="qty" name="qty" type="number" min="1" max="10" value="1">
         <button type="submit" data-testid="add-to-cart">${variant === "v2" ? "Add to bag" : "Add to cart"}</button>
       </form>
     </article>
     <script>
       document.querySelectorAll("[data-add-form]").forEach((form) => {
         form.addEventListener("submit", async (event) => {
           event.preventDefault();
           const data = Object.fromEntries(new FormData(form).entries());
           const response = await fetch("/api/cart/items", {
             method: "POST",
             headers: { "content-type": "application/json" },
             body: JSON.stringify({
               product_id: data.product_id,
               variant_id: data.variant_id,
               qty: Number(data.qty || 1),
             }),
           });
           if (response.ok) {
             window.location.href = "/cart";
           } else {
             const payload = await response.json().catch(() => ({}));
             window.alert(payload.error || "Could not add to cart");
           }
         });
       });
     </script>`,
    cartCount,
  );
}

export function cartPage(cart: CartView, cartCount: number): string {
  if (cart.lines.length === 0) {
    return layout(
      "Cart",
      `<h1>Your cart</h1>
       <p data-testid="cart-empty">Your cart is empty.</p>
       <p><a href="/">Continue shopping</a></p>`,
      cartCount,
    );
  }

  const rows = cart.lines
    .map(
      (line) => `<tr data-testid="cart-row">
        <td>
          <a href="/p/${line.product.id}">${escapeHtml(line.product.name)}</a><br>
          <span class="muted">${escapeHtml(line.variant.size)} / ${escapeHtml(line.variant.color)}</span>
        </td>
        <td>${formatPrice(line.product.priceCents)}</td>
        <td>
          <form method="post" action="/cart/update" class="inline">
            <input type="hidden" name="variant_id" value="${line.variant.id}">
            <label class="sr-only" for="qty-${line.variant.id}">Quantity</label>
            <input id="qty-${line.variant.id}" name="qty" type="number" min="0" max="10" value="${line.qty}">
            <button type="submit">Update</button>
          </form>
          <form method="post" action="/cart/remove" class="inline">
            <input type="hidden" name="variant_id" value="${line.variant.id}">
            <button type="submit" class="link">Remove</button>
          </form>
        </td>
        <td>${formatPrice(line.lineCents)}</td>
      </tr>`,
    )
    .join("");

  return layout(
    "Cart",
    `<h1>Your cart</h1>
     <table data-testid="cart-table">
       <thead><tr><th>Item</th><th>Price</th><th>Quantity</th><th>Total</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <p class="total">Subtotal: <strong data-testid="cart-subtotal">${formatPrice(
       cart.subtotalCents,
     )}</strong></p>
     <p><a class="button" href="/checkout" data-testid="checkout-link">Checkout</a></p>`,
    cartCount,
  );
}

export function checkoutPage(
  cart: CartView,
  cartCount: number,
  fields: Record<string, string> = {},
  variant: "v1" | "v2" = "v1",
): string {
  const error = (name: string) =>
    fields[name] ? `<p class="error" role="alert">${escapeHtml(fields[name])}</p>` : "";

  return layout(
    "Checkout",
    `<h1>Checkout</h1>
     ${
       variant === "v2"
         ? `<div role="dialog" aria-label="Before you continue" style="position:fixed;inset:0;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:10">
              <button type="button" onclick="this.parentElement.remove()">Continue to payment</button>
            </div>`
         : ""
     }
     <p>Subtotal: <strong>${formatPrice(cart.subtotalCents)}</strong></p>
     <form method="post" action="/checkout" data-checkout-form novalidate>
       <label for="name">Full name</label>
       <input id="name" name="name" autocomplete="name" required>
       ${error("name")}
       <label for="email">Email</label>
       <input id="email" name="email" type="email" autocomplete="email" required>
       ${error("email")}
       <label for="address">Address</label>
       <input id="address" name="address" autocomplete="street-address" required>
       ${error("address")}
       <label for="city">City</label>
       <input id="city" name="city" autocomplete="address-level2" required>
       ${error("city")}
       <label for="postal">Postal code</label>
       <input id="postal" name="postal" autocomplete="postal-code" required>
       ${error("postal")}
       <label for="card">Card number</label>
       <input id="card" name="card" inputmode="numeric" autocomplete="cc-number" required>
       ${error("card")}
       <button type="submit" data-testid="place-order">Place order</button>
     </form>
     <script>
       const form = document.querySelector("[data-checkout-form]");
       if (form) {
         form.addEventListener("submit", async (event) => {
           event.preventDefault();
           const data = Object.fromEntries(new FormData(form).entries());
           const response = await fetch("/api/checkout", {
             method: "POST",
             headers: { "content-type": "application/json" },
             body: JSON.stringify(data),
           });
           if (response.ok) {
             const payload = await response.json();
             window.location.href = payload.redirect;
           } else {
             const payload = await response.json().catch(() => ({}));
             window.alert(payload.error || "Checkout failed");
           }
         });
       }
     </script>`,
    cartCount,
  );
}

export function orderPage(order: Order, cartCount: number): string {
  const rows = order.items
    .map((item) => {
      const found = findVariant(item.productId, item.variantId);
      const label = found
        ? `${found.product.name} — ${found.variant.size} / ${found.variant.color}`
        : `${item.productId} / ${item.variantId}`;
      return `<tr><td>${escapeHtml(label)}</td><td>${item.qty}</td></tr>`;
    })
    .join("");

  return layout(
    "Order confirmed",
    `<h1>Order confirmed</h1>
     <p>Order <strong data-testid="order-id" data-order-id="${order.id}">${order.id}</strong></p>
     <p class="muted">Placed ${escapeHtml(order.createdAt)}</p>
     <table>
       <thead><tr><th>Item</th><th>Qty</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <p class="total">Total: <strong>${formatPrice(order.totalCents)}</strong></p>
     <p><a href="/">Continue shopping</a></p>`,
    cartCount,
  );
}

export function ordersPage(orders: Order[], cartCount: number): string {
  if (orders.length === 0) {
    return layout(
      "Orders",
      `<h1>Orders</h1><p data-testid="orders-empty">No orders yet.</p>`,
      cartCount,
    );
  }

  const rows = orders
    .map(
      (order) =>
        `<tr data-testid="order-row"><td><a href="/orders/${order.id}">${order.id}</a></td><td>${formatPrice(
          order.totalCents,
        )}</td><td>${escapeHtml(order.createdAt)}</td></tr>`,
    )
    .join("");

  return layout(
    "Orders",
    `<h1>Orders</h1>
     <table><thead><tr><th>Order</th><th>Total</th><th>Placed</th></tr></thead><tbody>${rows}</tbody></table>`,
    cartCount,
  );
}

export function errorPage(message: string, cartCount = 0): string {
  return layout(
    "Not found",
    `<h1>${escapeHtml(message)}</h1><p><a href="/">Back to catalog</a></p>`,
    cartCount,
  );
}
