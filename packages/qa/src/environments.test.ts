import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { authStatePath, parseEnvironments, resolveEnvironment } from "./environments.js";
import { QaError } from "./errors.js";

const dirs: string[] = [];

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-env-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const RAW = {
  dev: { baseUrl: "https://dev.app.test", profiles: ["admin", "member"], writes: true },
  prod: { baseUrl: "https://app.test/", profiles: ["readonly"] },
};

describe("parseEnvironments", () => {
  it("parses environments and defaults writes to false", () => {
    const parsed = parseEnvironments(RAW);
    expect(parsed.dev?.writes).toBe(true);
    expect(parsed.prod?.writes).toBe(false);
    expect(parsed.prod?.origin).toBe("https://app.test");
  });

  it("is empty when absent", () => {
    expect(parseEnvironments(undefined)).toEqual({});
  });

  it.each([
    ["an unknown key", { prod: { ...RAW.prod, write: false } }, /unknown key "write"/],
    ["a string writes", { prod: { ...RAW.prod, writes: "false" } }, /writes must be true or false/],
    ["no profiles", { prod: { baseUrl: "https://app.test", profiles: [] } }, /profiles/],
    ["a bad profile name", { prod: { ...RAW.prod, profiles: ["../x"] } }, /profiles/],
    ["a repeated profile", { prod: { ...RAW.prod, profiles: ["a", "a"] } }, /repeat/],
    ["a non-http URL", { prod: { ...RAW.prod, baseUrl: "file:///etc" } }, /http or https/],
    ["a bad environment name", { "../x": RAW.prod }, /not a valid environment name/],
    ["an array", [], /must be an object/],
  ])("rejects %s", (_name, raw, message) => {
    expect(() => parseEnvironments(raw)).toThrow(message);
  });
});

describe("authStatePath", () => {
  it("lives outside the project and differs per project, env, and profile", () => {
    const base = home();
    const a = authStatePath("/work/app", "qa", "admin", base);
    expect(a.startsWith(base)).toBe(true);
    expect(a.startsWith("/work/app")).toBe(false);
    expect(authStatePath("/other/app", "qa", "admin", base)).not.toBe(a);
    expect(authStatePath("/work/app", "dev", "admin", base)).not.toBe(a);
    expect(authStatePath("/work/app", "qa", "member", base)).not.toBe(a);
  });
});

describe("resolveEnvironment", () => {
  const environments = parseEnvironments(RAW);

  function saveSession(base: string, env: string, profile: string): string {
    const path = authStatePath("/work/app", env, profile, base);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{}");
    return path;
  }

  function code(run: () => unknown): string | undefined {
    try {
      run();
    } catch (error) {
      return error instanceof QaError ? error.code : "other";
    }
    return undefined;
  }

  it("returns undefined when no environment is named", () => {
    expect(resolveEnvironment(environments, {}, { root: "/work/app", env: {} })).toBeUndefined();
  });

  it("resolves a saved session and never mentions a credential", () => {
    const base = home();
    const path = saveSession(base, "dev", "member");
    const resolved = resolveEnvironment(
      environments,
      { env: "dev", as: "member" },
      { root: "/work/app", home: base, env: {} },
    );
    expect(resolved).toMatchObject({
      name: "dev",
      profile: "member",
      origin: "https://dev.app.test",
      writes: true,
      storageState: path,
    });
  });

  it("defaults the profile only when there is exactly one", () => {
    const base = home();
    saveSession(base, "prod", "readonly");
    const options = { root: "/work/app", home: base, env: {} };
    expect(resolveEnvironment(environments, { env: "prod" }, options)?.profile).toBe("readonly");
    expect(code(() => resolveEnvironment(environments, { env: "dev" }, options))).toBe(
      "invalid_request",
    );
  });

  it("types each refusal", () => {
    const options = { root: "/work/app", home: home(), env: {} };
    expect(code(() => resolveEnvironment(environments, { env: "nope" }, options))).toBe(
      "not_found",
    );
    expect(code(() => resolveEnvironment(environments, { env: "dev", as: "root" }, options))).toBe(
      "not_found",
    );
    expect(code(() => resolveEnvironment(environments, { as: "admin" }, options))).toBe(
      "invalid_request",
    );
    expect(
      code(() =>
        resolveEnvironment(
          environments,
          { env: "prod" },
          { ...options, env: { QA_BASE_URL: "https://elsewhere.test" } },
        ),
      ),
    ).toBe("invalid_request");
  });

  it("treats an Object.prototype name as unknown, not a crash", () => {
    const options = { root: "/work/app", home: home(), env: {} };
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(code(() => resolveEnvironment(environments, { env: name }, options))).toBe(
        "not_found",
      );
    }
  });

  it("asks a person to sign in when the session is missing", () => {
    try {
      resolveEnvironment(
        environments,
        { env: "dev", as: "admin" },
        { root: "/work/app", home: home(), env: {} },
      );
      expect.unreachable();
    } catch (error) {
      expect((error as QaError).code).toBe("auth_missing");
      expect((error as QaError).details?.next).toEqual([
        "portolan auth login --env dev --profile admin",
      ]);
    }
  });
});
