export const CATEGORIES = ["Software", "Travel", "Office", "Services"] as const;
export const STATUSES = ["paid", "pending", "overdue"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];

export type Row = {
  id: string;
  vendor: string;
  category: Category;
  amountCents: number;
  status: Status;
  date: string;
};

const VENDORS = [
  "Northwind Supply",
  "Acme Cloud",
  "Globex Travel",
  "Initech Services",
  "Umbrella Office",
  "Hooli Software",
  "Vandelay Freight",
  "Soylent Catering",
];

export const rows: Row[] = Array.from({ length: 48 }, (_, index) => ({
  id: `inv_${1001 + index}`,
  vendor: VENDORS[index % VENDORS.length] ?? "Unknown vendor",
  category: CATEGORIES[index % CATEGORIES.length] ?? "Software",
  amountCents: 1200 + ((index * 731) % 48_000),
  status: STATUSES[index % STATUSES.length] ?? "pending",
  date: `2026-${String(1 + (index % 9)).padStart(2, "0")}-${String(1 + (index % 27)).padStart(2, "0")}`,
}));

export type RowFilters = {
  q: string;
  status: string;
  category: string;
  page: number;
  pageSize?: number;
};

export type RowPage = {
  rows: Row[];
  total: number;
  page: number;
  pages: number;
};

export function filterRows(all: Row[], filters: RowFilters): RowPage {
  const query = filters.q.trim().toLowerCase();
  const status = STATUSES.includes(filters.status as Status) ? filters.status : "";
  const category = CATEGORIES.includes(filters.category as Category) ? filters.category : "";

  const filtered = all.filter((row) => {
    if (query && !`${row.id} ${row.vendor}`.toLowerCase().includes(query)) return false;
    if (status && row.status !== status) return false;
    if (category && row.category !== category) return false;
    return true;
  });

  const pageSize = filters.pageSize ?? 10;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, filters.page), pages);
  const start = (page - 1) * pageSize;

  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pages,
  };
}

export function summarize(all: Row[]): {
  totalCents: number;
  count: number;
  byStatus: Record<Status, number>;
} {
  const byStatus: Record<Status, number> = { paid: 0, pending: 0, overdue: 0 };
  let totalCents = 0;
  for (const row of all) {
    totalCents += row.amountCents;
    byStatus[row.status] += 1;
  }
  return { totalCents, count: all.length, byStatus };
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
