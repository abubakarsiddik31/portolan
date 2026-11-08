export type Variant = {
  id: string;
  size: string;
  color: string;
  stock: number;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  variants: Variant[];
};

export type CartItem = {
  productId: string;
  variantId: string;
  qty: number;
};

export type Cart = {
  items: CartItem[];
};

export type Customer = {
  name: string;
  email: string;
  address: string;
  city: string;
  postal: string;
};

export type Order = {
  id: string;
  sid: string;
  items: CartItem[];
  totalCents: number;
  customer: Customer;
  createdAt: string;
};

function variants(productId: string, sizes: string[], colors: string[], stock = 5): Variant[] {
  const suffix = productId.replace(/^p_/, "");
  return sizes.flatMap((size) =>
    colors.map((color) => ({
      id: `v_${suffix}_${size.toLowerCase().replace(/\s+/g, "_")}_${color
        .toLowerCase()
        .replace(/\s+/g, "_")}`,
      size,
      color,
      stock,
    })),
  );
}

export const products: Product[] = [
  {
    id: "p_101",
    name: "Everyday Tee",
    description: "A heavyweight cotton tee that survives the wash.",
    priceCents: 2400,
    variants: variants("p_101", ["S", "M", "L"], ["Blue", "Black"]),
  },
  {
    id: "p_102",
    name: "Canvas Tote",
    description: "Waxed canvas, leather handles, one honest pocket.",
    priceCents: 1800,
    variants: variants("p_102", ["One Size"], ["Natural"]),
  },
  {
    id: "p_103",
    name: "Merino Socks",
    description: "Thin merino socks for long days on your feet.",
    priceCents: 1600,
    variants: variants("p_103", ["S", "M", "L"], ["Charcoal"]),
  },
  {
    id: "p_104",
    name: "Field Jacket",
    description: "Four pockets, a storm flap, and no logo.",
    priceCents: 12800,
    variants: variants("p_104", ["S", "M", "L"], ["Olive"]),
  },
  {
    id: "p_105",
    name: "Camp Mug",
    description: "Enamel mug that is equally at home on a stove.",
    priceCents: 1400,
    variants: variants("p_105", ["One Size"], ["Enamel"]),
  },
  {
    id: "p_106",
    name: "Trail Cap",
    description: "Five-panel cap with a soft brim and a short rope.",
    priceCents: 2200,
    variants: variants("p_106", ["One Size"], ["Navy"]),
  },
];

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function findProduct(id: string): Product | undefined {
  return products.find((product) => product.id === id);
}

export function findVariant(
  productId: string,
  variantId: string,
): { product: Product; variant: Variant } | undefined {
  const product = findProduct(productId);
  const variant = product?.variants.find((candidate) => candidate.id === variantId);
  return product && variant ? { product, variant } : undefined;
}

export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return products;
  return products.filter((product) => {
    const haystack = [
      product.name,
      product.description,
      ...product.variants.flatMap((variant) => [variant.size, variant.color]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
