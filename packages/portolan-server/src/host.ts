export type BindPolicy = {
  /** When set, the server requires a bearer token. */
  authToken?: string;
  /** Explicit opt-in to a public bind without auth. */
  allowRemote?: boolean;
};

/**
 * Refuse to bind a public interface without authentication.
 *
 * The default host is loopback, so the common case is unaffected. A container
 * or a host that sets `0.0.0.0` must either set a token or opt in explicitly;
 * otherwise a session with the user's cookies is reachable from the network.
 */
export function assertBindAllowed(host: string, policy: BindPolicy = {}): void {
  if (isLoopbackHost(host)) return;
  if (policy.authToken !== undefined && policy.authToken.length > 0) return;
  if (policy.allowRemote === true) return;

  throw new Error(
    `refusing to bind ${host} without authentication; set PORTOLAN_AUTH_TOKEN or PORTOLAN_ALLOW_REMOTE=1`,
  );
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("127.")
  );
}
