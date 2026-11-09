import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PRD = readFileSync(join(import.meta.dirname, "../PRD.md"), "utf8");

describe("PRD v0.2", () => {
  it("is version 0.2 and references the decisions it must match", () => {
    expect(PRD).toContain("| **Version** | 0.2 |");

    for (const adr of ["ADR-002", "ADR-003", "ADR-004", "ADR-005"]) {
      expect(PRD, `PRD does not reference ${adr}`).toContain(adr);
    }
  });

  it("describes a site-map runtime, not a browser", () => {
    expect(PRD).toContain("turns a website into a map");
    expect(PRD).toContain("not a browser for agents");
    expect(PRD).toContain("No LLM in the hot path");
  });

  it("keeps the gates closed per ADR-005", () => {
    expect(PRD).toContain("not passed");
    expect(PRD).toContain("G0, G1, and G2");
    expect(PRD).toContain("scripted");
    expect(PRD).toContain("v0.1.0 is not released");
  });

  it("names the MCP surface and the tiers", () => {
    for (const tool of ["open_site", "call", "view", "act", "read", "fallback_done"]) {
      expect(PRD).toContain(tool);
    }
    for (const tier of ["webmcp", "url", "http", "ui"]) {
      expect(PRD).toContain(tier);
    }
  });

  it("records what changed from v0.1", () => {
    expect(PRD).toContain("Appendix C");
    expect(PRD).toContain("ADR-008");
  });
});
