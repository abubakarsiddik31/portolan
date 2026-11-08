import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMap } from "./load.js";

const DOC = join(import.meta.dirname, "../../../../docs/spec/map-v0.md");

function maps(): unknown[] {
  const doc = readFileSync(DOC, "utf8");
  return [...doc.matchAll(/```json\r?\n([\s\S]*?)```/g)]
    .map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>)
    .filter((value) => typeof value.site === "string");
}

describe("map spec v0", () => {
  it("every example map validates with the real loader", () => {
    const examples = maps();

    expect(examples).toHaveLength(2);
    for (const example of examples) {
      expect(() => loadMap(example)).not.toThrow();
    }
  });

  it("documents every top-level and op field", () => {
    const doc = readFileSync(DOC, "utf8");
    const fields = [
      "site",
      "origins",
      "version",
      "states",
      "ops",
      "entities",
      "auth",
      "compiled_from",
      "verified_at",
      "name",
      "summary",
      "params",
      "returns",
      "from",
      "to",
      "post",
      "effect",
      "outcome_check",
      "confirm",
      "impls",
      "status",
    ];

    for (const field of fields) expect(doc).toContain(`\`${field}\``);
  });

  it("documents every locator, extractor, impl, step, and check kind", () => {
    const doc = readFileSync(DOC, "utf8");
    const values = [
      "role",
      "label",
      "test_id",
      "name",
      "name_re",
      "ctx",
      "ordinal",
      "attr",
      "attribute",
      "pattern",
      "fields",
      "rows",
      "composite",
      "json",
      "download",
      "none",
      "webmcp",
      "url",
      "http",
      "ui",
      "click",
      "check",
      "uncheck",
      "fill",
      "select",
      "press",
      "await_state",
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "exists",
      "absent",
      "text",
      "read",
      "write",
      "irreversible",
      "verified",
      "degraded",
      "broken",
    ];

    for (const value of values) expect(doc).toContain(value);
  });
});
