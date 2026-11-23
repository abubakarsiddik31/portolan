import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlaywrightEngine, SemanticNode, Substrate } from "@abubakarsiddiik/substrate";
import { afterEach, describe, expect, it } from "vitest";

import { readRecipe, runAuthLogin, runAuthRefresh } from "./auth.js";
import {
  describeExpiry,
  looksLikeAuthFailure,
  parseFill,
  readSecret,
  replayRecipe,
  sessionExpiry,
} from "./auth-recipe.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-auth-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function node(nodeId: string, role: string, name: string, extra: Partial<SemanticNode> = {}) {
  return {
    nodeId,
    role,
    name,
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
    ...extra,
  } as SemanticNode;
}

/** A login page: two fields and a button. Typing then clicking Sign in leaves the form. */
function loginPage(fields: SemanticNode[]) {
  const filled = new Map<string, string>();
  let signedIn = false;
  const nodes = () =>
    signedIn
      ? [node("root", "RootWebArea", "Dashboard")]
      : [node("root", "RootWebArea", "Login"), ...fields, node("btn", "button", "Sign in")];
  const view = () => ({
    snapshot: {
      doc: 1,
      v: 1,
      url: `http://app.test${signedIn ? "/home" : "/login"}`,
      title: "",
      nodes: nodes(),
    },
    refs: {
      byNode: new Map(nodes().map((n) => [n.nodeId, { ref: `r_${n.nodeId}` }])),
      byRef: new Map(),
    },
  });

  const substrate = {
    goto: async () => view(),
    state: () => view(),
    settle: async () => view(),
    act: async (request: { ref: string; do: string; value?: string }) => {
      if (request.do === "fill") filled.set(request.ref, request.value ?? "");
      if (request.do === "click" && request.ref === "r_btn") signedIn = filled.size > 0;
      return { ok: true };
    },
  } as unknown as Substrate;

  return { substrate, filled };
}

const engine = {
  navigate: async () => ({}),
  storageState: async () => ({ cookies: [], origins: [] }),
  close: async () => {},
  withPage: async () => undefined,
} as unknown as PlaywrightEngine;

describe("recipe parts", () => {
  it("parses a fill spec and rejects a malformed one", () => {
    expect(parseFill("textbox:Username or email=APP_USER")).toEqual({
      role: "textbox",
      name: "Username or email",
      env: "APP_USER",
    });
    expect(parseFill("Password=APP_PASSWORD")).toEqual({ name: "Password", env: "APP_PASSWORD" });
    expect(() => parseFill("Password")).toThrow(/must look like/);
    expect(() => parseFill("Password=not valid")).toThrow(/must look like/);
  });

  it("reads a secret from the environment or a *_FILE, and nowhere else", () => {
    const dir = tempDir();
    const file = join(dir, "pw");
    writeFileSync(file, "from-file\n");

    expect(readSecret("PW", { PW: "direct" })).toBe("direct");
    expect(readSecret("PW", { PW_FILE: file })).toBe("from-file");
    expect(() => readSecret("PW", {})).toThrow(/set PW \(or PW_FILE\)/);
  });

  it("reads the earliest JWT expiry from a saved session", () => {
    const jwt = (exp: number) =>
      `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig12345`;
    const state = {
      cookies: [{ value: "plain" }],
      origins: [{ localStorage: [{ value: jwt(2_000_000_000) }, { value: jwt(1_900_000_000) }] }],
    };

    expect(sessionExpiry(state)).toBe(1_900_000_000_000);
    expect(sessionExpiry({ cookies: [], origins: [] })).toBeUndefined();
    expect(describeExpiry(1_000_000 + 12 * 60_000, 1_000_000)).toBe("expires in 12m");
    expect(describeExpiry(1_000_000 - 3 * 60_000, 1_000_000)).toBe("expired 3m ago");
  });

  it("tells a lapsed session from a broken op", () => {
    expect(looksLikeAuthFailure('op "x" needs dashboard, found login')).toBe(true);
    expect(looksLikeAuthFailure("401 Unauthorized")).toBe(true);
    expect(looksLikeAuthFailure("locator did not resolve")).toBe(false);
  });
});

describe("replayRecipe", () => {
  const recipe = {
    url: "http://app.test/login",
    fills: [
      { role: "textbox", name: "Username or email", env: "APP_USER" },
      { role: "textbox", name: "Password", env: "APP_PASSWORD" },
    ],
    submit: "Sign in",
  };
  const env = { APP_USER: "ada", APP_PASSWORD: "s3cret-value" };

  it("fills each field from the environment and submits", async () => {
    const page = loginPage([
      node("u", "textbox", "Username or email"),
      node("p", "textbox", "Password"),
    ]);

    await replayRecipe(recipe, engine, page.substrate, env);
    expect([...page.filled.values()]).toEqual(["ada", "s3cret-value"]);
  });

  it("falls back to field order when the labels have no accessible name", async () => {
    const page = loginPage([node("u", "textbox", ""), node("p", "textbox", "")]);

    await replayRecipe(recipe, engine, page.substrate, env);
    expect([...page.filled.entries()]).toEqual([
      ["r_u", "ada"],
      ["r_p", "s3cret-value"],
    ]);
  });

  it("names the fields the page offers, and never prints a secret, when it fails", async () => {
    const page = loginPage([node("e", "textbox", "Email address")]);

    const error = await replayRecipe(
      {
        ...recipe,
        fills: [
          { name: "Nonsense", env: "APP_USER" },
          { name: "Nope", env: "APP_PASSWORD" },
        ],
      },
      engine,
      page.substrate,
      env,
    ).catch((caught: Error) => caught);

    // The first fill falls back to order and takes the only field; the second finds none left.
    expect(String(error)).toContain('no field "Nope"');
    expect(String(error)).toContain('"Email address"');
    expect(String(error)).not.toContain("s3cret-value");
    expect(String(error)).not.toContain("ada");
  });

  it("fails, and says why, when the form is still there after submitting", async () => {
    // Nothing is filled into a page that never leaves the form: the button does not sign in.
    const page = loginPage([node("u", "textbox", ""), node("p", "textbox", "")]);
    const stuck = {
      ...page.substrate,
      goto: page.substrate.goto,
      state: page.substrate.state,
      settle: page.substrate.settle,
      act: async () => ({ ok: true }),
    } as unknown as Substrate;

    await expect(replayRecipe(recipe, engine, stuck, env)).rejects.toThrow(
      /sign-in did not complete/,
    );
  });

  it("fails clearly when a required variable is not set", async () => {
    const page = loginPage([
      node("u", "textbox", "Username or email"),
      node("p", "textbox", "Password"),
    ]);
    await expect(replayRecipe(recipe, engine, page.substrate, {})).rejects.toThrow(/set APP_USER/);
  });
});

describe("unattended login and refresh", () => {
  it("signs in headless, saves the session 0600 and a recipe of names only, then refreshes", async () => {
    const dir = tempDir();
    const out = join(dir, "state", "auth.json");
    process.env.APP_USER = "ada";
    process.env.APP_PASSWORD = "s3cret-value";
    const headless: Array<boolean | undefined> = [];
    const pages: Array<ReturnType<typeof loginPage>> = [];

    const deps = {
      launch: (async (options: { headless?: boolean }) => {
        headless.push(options.headless);
        return engine;
      }) as unknown as typeof PlaywrightEngine.launch,
      substrateFor: () => {
        const page = loginPage([
          node("u", "textbox", "Username or email"),
          node("p", "textbox", "Password"),
        ]);
        pages.push(page);
        return page.substrate;
      },
    };
    const recipe = {
      url: "http://app.test/login",
      fills: [
        { role: "textbox", name: "Username or email", env: "APP_USER" },
        { role: "textbox", name: "Password", env: "APP_PASSWORD" },
      ],
      submit: "Sign in",
    };

    await runAuthLogin({ url: recipe.url, out, recipe, chrome: "chrome" }, deps);

    expect(headless).toEqual([true]);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(readRecipe(out)).toEqual(recipe);
    expect(JSON.stringify(readRecipe(out))).not.toContain("s3cret-value");

    await runAuthRefresh({ out, chrome: "chrome" }, deps);
    expect(headless).toEqual([true, true]);
    expect([...(pages[1]?.filled.values() ?? [])]).toEqual(["ada", "s3cret-value"]);

    await expect(runAuthRefresh({ out: join(dir, "other.json") }, deps)).rejects.toThrow(
      /no recipe saved/,
    );
  });
});
