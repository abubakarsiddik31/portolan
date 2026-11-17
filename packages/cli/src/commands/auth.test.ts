import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAuthLogin } from "./auth.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-auth-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeEngine(current: () => string, storage: { path?: string; closed: boolean }) {
  return {
    navigate: async () => ({ url: current(), title: "", status: 200 }),
    url: () => current(),
    storageState: async (path?: string) => {
      storage.path = path;
      if (path !== undefined) writeFileSync(path, "{}", "utf8");
      return { cookies: [], origins: [] };
    },
    close: async () => {
      storage.closed = true;
    },
  };
}

describe("runAuthLogin", () => {
  it("saves the session after the URL leaves the sign-in page", async () => {
    const dir = tempDir();
    const out = join(dir, "auth.json");
    const storage: { path?: string; closed: boolean } = { closed: false };
    let url = "https://app.test/sign-in";

    const result = await runAuthLogin(
      { url: "https://app.test/sign-in", out },
      {
        launch: (async () => fakeEngine(() => url, storage)) as never,
        now: () => {
          const value = Date.now();
          return value;
        },
        sleep: async () => {
          url = "https://app.test/dashboard";
        },
        log: () => undefined,
      },
    );

    expect(result.out).toBe(out);
    expect(storage.path).toBe(out);
    expect(storage.closed).toBe(true);
  });

  it("times out when the page never leaves sign-in", async () => {
    let now = 0;

    await expect(
      runAuthLogin(
        { url: "https://app.test/sign-in", out: join(tempDir(), "auth.json"), timeoutMs: 1000 },
        {
          launch: (async () =>
            fakeEngine(() => "https://app.test/sign-in", { closed: false })) as never,
          now: () => {
            now += 600;
            return now;
          },
          sleep: async () => undefined,
          log: () => undefined,
        },
      ),
    ).rejects.toThrow(/timed out/);
  });
});
