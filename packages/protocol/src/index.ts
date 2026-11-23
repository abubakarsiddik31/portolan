export * from "./envelope.js";
export * from "./errors.js";
export * from "./map/lint.js";
export * from "./map/load.js";
export * from "./map/schema.js";
export * from "./map/types.js";
export * from "./map/validate.js";
export * from "./meter.js";
export * from "./name-template.js";
export * from "./paths.js";
export * from "./session.js";

export const PROTOCOL_NAME = "portolan" as const;

/** Version of the HTTP/MCP surface, not of the product. */
export const PROTOCOL_VERSION = "0.0.0" as const;

export type ProtocolName = typeof PROTOCOL_NAME;
export type ProtocolVersion = typeof PROTOCOL_VERSION;
