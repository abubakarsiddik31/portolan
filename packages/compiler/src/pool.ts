/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep the order
 * of `items`; a rejection from `fn` rejects the whole call.
 */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await fn(item, index);
    }
  };

  const width = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
