export type Book = {
  id: string;
  title: string;
  author: string;
  genre: string;
  available: boolean;
};

export type Loan = {
  id: string;
  bookId: string;
  title: string;
  borrowedAt: string;
};

export const books: Book[] = [
  {
    id: "b_101",
    title: "The Analytical Engine",
    author: "Ada Lovelace",
    genre: "history",
    available: true,
  },
  {
    id: "b_102",
    title: "Compilers at Dawn",
    author: "Grace Hopper",
    genre: "engineering",
    available: true,
  },
  {
    id: "b_103",
    title: "Orbital Mechanics",
    author: "Katherine Johnson",
    genre: "science",
    available: true,
  },
  {
    id: "b_104",
    title: "The Bletchley Papers",
    author: "Alan Turing",
    genre: "history",
    available: true,
  },
  {
    id: "b_105",
    title: "Apollo Guidance",
    author: "Margaret Hamilton",
    genre: "engineering",
    available: true,
  },
  {
    id: "b_106",
    title: "A Field Guide to Stars",
    author: "Cecilia Payne",
    genre: "science",
    available: true,
  },
];

export function findBook(id: string): Book | undefined {
  return books.find((book) => book.id === id);
}

export function searchBooks(query: string): Book[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return books;
  return books.filter(
    (book) =>
      book.title.toLowerCase().includes(needle) ||
      book.author.toLowerCase().includes(needle) ||
      book.genre.toLowerCase().includes(needle),
  );
}
