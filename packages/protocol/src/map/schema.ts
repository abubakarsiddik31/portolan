/**
 * JSON Schema (2020-12) for a Portolan site map, version 0.
 *
 * This is the contract a map is validated against before the runtime will
 * load it. It is deliberately strict: an unknown field is an error, because a
 * typo in a map should fail loudly instead of silently disabling an op.
 *
 * Cross-field rules that JSON Schema cannot express (state references, write
 * safety, duplicate names) live in `load.ts` and run after this schema passes.
 */
export const MAP_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://portolan.dev/schema/map-v0.json",
  title: "Portolan Site Map v0",
  type: "object",
  additionalProperties: false,
  required: [
    "site",
    "origins",
    "version",
    "states",
    "ops",
    "entities",
    "compiled_from",
    "verified_at",
  ],
  properties: {
    site: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", maxLength: 64 },
    origins: {
      type: "array",
      minItems: 1,
      items: { type: "string", pattern: "^https?://" },
    },
    version: { type: "integer", minimum: 1 },
    states: { type: "array", minItems: 1, items: { $ref: "#/$defs/state" } },
    ops: { type: "array", minItems: 1, items: { $ref: "#/$defs/op" } },
    entities: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/jsonSchema" },
    },
    auth: { $ref: "#/$defs/auth" },
    compiled_from: { type: "array", items: { type: "string", minLength: 1 } },
    verified_at: { type: "string", minLength: 1 },
  },
  $defs: {
    id: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },

    /** Params, returns, and entities are JSON Schema objects. */
    jsonSchema: { type: "object" },

    locator: {
      type: "object",
      additionalProperties: false,
      anyOf: [
        { type: "object", properties: { role: {} }, required: ["role"] },
        { type: "object", properties: { label: {} }, required: ["label"] },
        { type: "object", properties: { test_id: {} }, required: ["test_id"] },
      ],
      dependentRequired: { name: ["role"], name_re: ["role"] },
      not: {
        type: "object",
        properties: { name: {}, name_re: {} },
        required: ["name", "name_re"],
      },
      properties: {
        role: { type: "string", minLength: 1 },
        label: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        name_re: { type: "string", minLength: 1 },
        ctx: { type: "string", minLength: 1 },
        ordinal: { type: "integer", minimum: 0 },
        test_id: { type: "string", minLength: 1 },
        attr: { enum: ["name", "value", "text", "href"] },
        attribute: { type: "string", minLength: 1 },
        pattern: { type: "string", minLength: 1 },
      },
    },

    extractor: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "fields"],
          properties: {
            kind: { const: "fields" },
            fields: {
              type: "object",
              minProperties: 1,
              additionalProperties: { $ref: "#/$defs/locator" },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "container", "row", "cols"],
          properties: {
            kind: { const: "rows" },
            container: { $ref: "#/$defs/locator" },
            row: { $ref: "#/$defs/locator" },
            cols: {
              type: "object",
              minProperties: 1,
              additionalProperties: { $ref: "#/$defs/locator" },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: { const: "composite" },
            fields: {
              type: "object",
              minProperties: 1,
              additionalProperties: { $ref: "#/$defs/locator" },
            },
            rows: {
              type: "object",
              additionalProperties: false,
              required: ["as", "container", "row", "cols"],
              properties: {
                as: {
                  type: "string",
                  pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$",
                },
                container: { $ref: "#/$defs/locator" },
                row: { $ref: "#/$defs/locator" },
                cols: {
                  type: "object",
                  minProperties: 1,
                  additionalProperties: { $ref: "#/$defs/locator" },
                },
              },
            },
          },
          anyOf: [
            { type: "object", properties: { fields: {} }, required: ["fields"] },
            { type: "object", properties: { rows: {} }, required: ["rows"] },
          ],
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: { const: "json" },
            path: { type: "string" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "download" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "none" } },
        },
      ],
    },

    uiStep: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["do", "target"],
          properties: {
            do: { enum: ["click", "check", "uncheck"] },
            target: { $ref: "#/$defs/locator" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["do", "target", "value"],
          properties: {
            do: { enum: ["fill", "select"] },
            target: { $ref: "#/$defs/locator" },
            value: { type: "string" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["do", "key"],
          properties: {
            do: { const: "press" },
            key: { type: "string", minLength: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["do", "state"],
          properties: {
            do: { const: "await_state" },
            state: { $ref: "#/$defs/id" },
            timeout_ms: { type: "integer", minimum: 1 },
          },
        },
      ],
    },

    httpStep: {
      type: "object",
      additionalProperties: false,
      required: ["method", "url"],
      properties: {
        method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
        url: { type: "string", minLength: 1 },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: {},
        bind: { type: "object", additionalProperties: { type: "string" } },
      },
    },

    impl: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["tier", "tool"],
          properties: {
            tier: { const: "webmcp" },
            tool: { type: "string", minLength: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["tier", "route", "extract"],
          properties: {
            tier: { const: "url" },
            route: { type: "string", minLength: 1 },
            extract: { $ref: "#/$defs/extractor" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["tier", "steps", "extract"],
          properties: {
            tier: { const: "http" },
            steps: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/httpStep" },
            },
            extract: { $ref: "#/$defs/extractor" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["tier", "steps", "extract"],
          properties: {
            tier: { const: "ui" },
            steps: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/uiStep" },
            },
            extract: { $ref: "#/$defs/extractor" },
          },
        },
      ],
    },

    check: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "pattern"],
          properties: {
            kind: { const: "url" },
            pattern: { type: "string", minLength: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "state"],
          properties: {
            kind: { const: "state" },
            state: { $ref: "#/$defs/id" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "locator"],
          properties: {
            kind: { const: "exists" },
            locator: { $ref: "#/$defs/locator" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "locator"],
          properties: {
            kind: { const: "absent" },
            locator: { $ref: "#/$defs/locator" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "locator", "contains"],
          properties: {
            kind: { const: "text" },
            locator: { $ref: "#/$defs/locator" },
            contains: { type: "string" },
          },
        },
      ],
    },

    state: {
      type: "object",
      additionalProperties: false,
      required: ["id", "marks"],
      properties: {
        id: { $ref: "#/$defs/id" },
        url: { type: "string", minLength: 1 },
        marks: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/locator" },
        },
        not: { type: "array", items: { $ref: "#/$defs/locator" } },
      },
    },

    auth: {
      type: "object",
      additionalProperties: false,
      required: ["state", "login_op"],
      properties: {
        state: { $ref: "#/$defs/id" },
        login_op: { $ref: "#/$defs/id" },
      },
    },

    op: {
      type: "object",
      additionalProperties: false,
      required: [
        "name",
        "version",
        "summary",
        "params",
        "returns",
        "from",
        "to",
        "post",
        "effect",
        "impls",
        "status",
      ],
      properties: {
        name: { $ref: "#/$defs/id" },
        version: { type: "integer", minimum: 1 },
        summary: { type: "string", minLength: 1, maxLength: 200 },
        params: { $ref: "#/$defs/jsonSchema" },
        returns: { $ref: "#/$defs/jsonSchema" },
        from: { type: "array", minItems: 1, items: { $ref: "#/$defs/id" } },
        to: { type: "array", minItems: 1, items: { $ref: "#/$defs/id" } },
        post: { type: "array", items: { $ref: "#/$defs/check" } },
        effect: { enum: ["read", "write", "irreversible"] },
        outcome_check: { $ref: "#/$defs/id" },
        confirm: { type: "boolean" },
        impls: { type: "array", minItems: 1, items: { $ref: "#/$defs/impl" } },
        status: { enum: ["verified", "degraded", "broken"] },
      },
    },
  },
};
