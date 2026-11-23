import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { authStatePath, parseEnvironments } from "@abubakarsiddiik/qa";
import { afterEach, describe, expect, it } from "vitest";

import { authStatusLines, resolveLoginTarget, runAuthLogin } from "./auth.js";

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
    storageState: async () => ({ cookies: [{ name: "sid" }], origins: [] }),
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
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
      cookies: [{ name: "sid" }],
      origins: [],
    });
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

describe("runAuthLogin, confirmed sign-in", () => {
  it("waits for the person instead of reading the URL, and writes a 0600 file", async () => {
    const dir = tempDir();
    const out = join(dir, "sessions", "qa", "admin.json");
    let confirmed = false;

    const result = await runAuthLogin(
      {
        url: "https://app.test/sign-in",
        out,
        confirm: async () => {
          confirmed = true;
        },
      },
      {
        launch: (async () =>
          fakeEngine(() => "https://app.test/sign-in", { closed: false })) as never,
        sleep: async () => {
          throw new Error("the URL heuristic must not run");
        },
        log: () => undefined,
      },
    );

    expect(confirmed).toBe(true);
    expect(result.out).toBe(out);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "sessions")).mode & 0o777).toBe(0o700);
  });
});

describe("resolveLoginTarget and authStatusLines", () => {
  const environments = parseEnvironments({
    qa: {
      baseUrl: "https://qa.app.test",
      loginUrl: "https://qa.app.test/login",
      profiles: ["admin", "member"],
    },
    prod: { baseUrl: "https://app.test", profiles: ["readonly"] },
  });

  it("takes the sign-in page and path from config", () => {
    const home = tempDir();
    const target = resolveLoginTarget(environments, "/work/app", "qa", "admin", home);
    expect(target.url).toBe("https://qa.app.test/login");
    expect(target.out).toBe(authStatePath("/work/app", "qa", "admin", home));
    expect(resolveLoginTarget(environments, "/work/app", "prod", undefined, home).url).toBe(
      "https://app.test",
    );
  });

  it("refuses an unknown environment, a missing profile, and a wrong profile", () => {
    expect(() => resolveLoginTarget(environments, "/work/app", "stage", "admin")).toThrow(
      /no environment "stage"/,
    );
    expect(() => resolveLoginTarget(environments, "/work/app", "qa", undefined)).toThrow(
      /needs --profile/,
    );
    expect(() => resolveLoginTarget(environments, "/work/app", "qa", "root")).toThrow(
      /no profile "root"/,
    );
  });

  it("reports which profiles have a session, never its path", () => {
    const home = tempDir();
    const path = authStatePath("/work/app", "qa", "admin", home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}");

    const lines = authStatusLines(
      environments,
      "/work/app",
      () => Date.now() + 5 * 3_600_000 + 60_000,
      home,
    );
    expect(lines[0]).toMatch(/qa\/admin\s+saved 5h ago/);
    expect(lines[1]).toMatch(
      /qa\/member\s+no session\s+portolan auth login --env qa --profile member/,
    );
    expect(lines.join("\n")).not.toContain(home);
  });
});
