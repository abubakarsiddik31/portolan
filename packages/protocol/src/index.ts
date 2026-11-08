/**
 * Portolan protocol constants.
 *
 * The wire schemas land in T2.01. Until then this package exists so the
 * workspace, build graph, and CI have a real module to compile and test.
 */
export const PROTOCOL_NAME = "portolan" as const;

/** Version of the HTTP/MCP surface, not of the product. */
export const PROTOCOL_VERSION = "0.0.0" as const;

export type ProtocolName = typeof PROTOCOL_NAME;
export type ProtocolVersion = typeof PROTOCOL_VERSION;
