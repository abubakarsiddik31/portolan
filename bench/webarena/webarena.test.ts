import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const SHOPPING = process.env.SHOPPING_URL ?? "http://127.0.0.1:7770/";
const GITLAB = process.env.GITLAB_URL ?? "http://127.0.0.1:8023/users/sign_in";
const ENABLED = process.env.WEBARENA_TESTS === "1";
const RESET = process.env.WEBARENA_RESET === "1";

async function status(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function reachable(): Promise<{ shopping: number; gitlab: number }> {
  const [shopping, gitlab] = await Promise.all([status(SHOPPING), status(GITLAB)]);
  return { shopping, gitlab };
}

describe.skipIf(!ENABLED)("webarena apps", () => {
  it("reaches shopping and GitLab", async () => {
    const result = await reachable();

    expect(result.shopping).toBeGreaterThan(0);
    expect(result.shopping).toBeLessThan(400);
    expect(result.gitlab).toBeGreaterThan(0);
    expect(result.gitlab).toBeLessThan(400);
  }, 60_000);

  it.skipIf(!RESET)(
    "resets both apps and reaches them again",
    async () => {
      const result = await execFileAsync("bash", [join(import.meta.dirname, "reset.sh")], {
        timeout: 1_500_000,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      });

      expect(result.stdout).toContain("reachable and reset");

      const after = await reachable();
      expect(after.shopping).toBeGreaterThan(0);
      expect(after.shopping).toBeLessThan(400);
      expect(after.gitlab).toBeGreaterThan(0);
      expect(after.gitlab).toBeLessThan(400);
    },
    1_600_000,
  );
});
