export type Ticket = {
  id: string;
  subject: string;
  status: "open" | "pending" | "closed";
  priority: "low" | "normal" | "high";
  requester: string;
};

export type TicketFilters = {
  q: string;
  status: string;
  page: number;
};

export const STATUSES = ["open", "pending", "closed"] as const;
export const PRIORITIES = ["low", "normal", "high"] as const;

export const tickets: Ticket[] = Array.from({ length: 12 }, (_, index) => {
  const status = STATUSES[index % STATUSES.length] ?? "open";
  const priority = PRIORITIES[index % PRIORITIES.length] ?? "normal";
  return {
    id: `t_${1001 + index}`,
    subject: `Issue ${1001 + index}: ${["printer", "login", "billing", "network"][index % 4]} trouble`,
    status,
    priority,
    requester: `user${index + 1}@example.com`,
  };
});

export function findTicket(id: string): Ticket | undefined {
  return tickets.find((ticket) => ticket.id === id);
}

export function filterTickets(filters: TicketFilters): {
  rows: Ticket[];
  page: number;
  pages: number;
  total: number;
} {
  const needle = filters.q.trim().toLowerCase();
  const matched = tickets.filter(
    (ticket) =>
      (filters.status.length === 0 || ticket.status === filters.status) &&
      (needle.length === 0 ||
        ticket.subject.toLowerCase().includes(needle) ||
        ticket.requester.toLowerCase().includes(needle)),
  );
  const pageSize = 5;
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(1, filters.page), pages);
  return {
    rows: matched.slice((page - 1) * pageSize, page * pageSize),
    page,
    pages,
    total: matched.length,
  };
}
