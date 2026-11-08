import { findChrome } from "@portolan/substrate";
import { describe, expect, it } from "vitest";

import { budget, measurePerf } from "./measure.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

describe.skipIf(!ENABLED)("op latency", () => {
  it("meets the p50 budget on the store fixture", async () => {
    const samples = await measurePerf({ runs: 10 });

    expect(samples.length).toBeGreaterThan(0);

    for (const sample of samples) {
      expect(sample.ok, `${sample.op} did not run`).toBe(true);
      expect(
        sample.p50,
        `${sample.op} (${sample.tier}) p50 ${sample.p50}ms > ${budget(sample.tier)}ms`,
      ).toBeLessThanOrEqual(budget(sample.tier));
    }
  }, 120_000);
});
