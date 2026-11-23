/**
 * True for a path segment that is an identifier rather than a page name: a
 * number, a UUID, a long hex string, a prefixed id (`p_101`, `ord_1`), or a
 * long mixed string with a digit in it.
 */
export function isIdLike(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{8,}$/i.test(segment) ||
    /^[a-z]{1,6}_[a-z0-9_]*\d[a-z0-9_]*$/i.test(segment) ||
    (/[0-9]/.test(segment) && segment.length >= 12)
  );
}
