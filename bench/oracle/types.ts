export type Customer = {
  name: string;
  email: string;
  address: string;
  city: string;
  postal: string;
  card: string;
};

export type StoreProduct = {
  id: string;
  name: string;
  price: string;
};

export type ProductDetail = StoreProduct & {
  variants: string[];
};

export type CartItem = {
  name: string;
  qty: number;
  total: string;
};

export type Cart = {
  items: CartItem[];
  subtotal: string;
  count: number;
};

export type Order = {
  orderId: string;
};

export type Application = {
  name: string;
  email: string;
  company: string;
  role: string;
  teamSize: number;
};

export type Submission = {
  submissionId: string;
};

export type InvoiceRow = {
  id: string;
  vendor: string;
  category: string;
  amount: string;
  status: string;
  date: string;
};

export type ExportResult = {
  filename: string;
  content: string;
};
