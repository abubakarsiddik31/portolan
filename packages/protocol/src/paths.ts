/**
 * The one directory Portolan creates in a project.
 *
 * Committed artifacts (config, cases, maps, policies, skills) live here next to
 * an ignored `state/` directory. Deriving every default from this constant keeps
 * the CLI, the QA runner, and the MCP server on the same layout.
 */
export const PORTOLAN_DIR = ".portolan" as const;

/** Config path relative to the project root. */
export const PORTOLAN_CONFIG = `${PORTOLAN_DIR}/config.json` as const;

/** The pre-`.portolan/` config path, still read with a deprecation notice. */
export const LEGACY_CONFIG = "portolan.config.json" as const;
