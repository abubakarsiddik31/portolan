import { describe, expect, it } from "vitest";

import {
  ChainCredentialStore,
  createCredentialStore,
  EnvCredentialStore,
  KeychainCredentialStore,
} from "./credentials.js";

describe("EnvCredentialStore", () => {
  const store = new EnvCredentialStore({
    PORTOLAN_STORE_API_KEY: "store-secret",
    PORTOLAN_PORTAL_API_KEY: "portal-secret",
    PORTOLAN_MY_SITE_API_KEY: "dash-secret",
  });

  it("scopes a credential to its site", async () => {
    expect(await store.get("store", "api_key")).toBe("store-secret");
    expect(await store.get("portal", "api_key")).toBe("portal-secret");
    expect(await store.get("store", "other")).toBeUndefined();
  });

  it("normalizes a site name into the variable", async () => {
    expect(await store.get("my-site", "api key")).toBe("dash-secret");
  });

  it("treats an empty value as missing", async () => {
    expect(
      await new EnvCredentialStore({ PORTOLAN_STORE_API_KEY: "" }).get("store", "api_key"),
    ).toBeUndefined();
  });
});

describe("KeychainCredentialStore", () => {
  it("reads a macOS generic password by site and key", async () => {
    const calls: string[][] = [];
    const store = new KeychainCredentialStore({
      platform: "darwin",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { stdout: "keychain-secret\n" };
      },
    });

    expect(await store.get("store", "api_key")).toBe("keychain-secret");
    expect(calls[0]).toEqual([
      "security",
      "find-generic-password",
      "-s",
      "portolan:store:api_key",
      "-w",
    ]);
  });

  it("reads a Linux secret-tool entry by site and key", async () => {
    const calls: string[][] = [];
    const store = new KeychainCredentialStore({
      platform: "linux",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { stdout: "linux-secret" };
      },
    });

    expect(await store.get("portal", "password")).toBe("linux-secret");
    expect(calls[0]).toEqual([
      "secret-tool",
      "lookup",
      "service",
      "portolan",
      "site",
      "portal",
      "key",
      "password",
    ]);
  });

  it("returns undefined on an unknown platform or a failed lookup", async () => {
    expect(
      await new KeychainCredentialStore({ platform: "win32" }).get("store", "api_key"),
    ).toBeUndefined();

    const failing = new KeychainCredentialStore({
      platform: "darwin",
      run: async () => {
        throw new Error("not found");
      },
    });
    expect(await failing.get("store", "api_key")).toBeUndefined();
  });
});

describe("ChainCredentialStore", () => {
  it("tries env first and falls back to the keychain", async () => {
    const env = new EnvCredentialStore({ PORTOLAN_STORE_API_KEY: "env-secret" });
    const keychain = new KeychainCredentialStore({
      platform: "darwin",
      run: async () => ({ stdout: "keychain-secret" }),
    });
    const chain = new ChainCredentialStore([env, keychain]);

    expect(await chain.get("store", "api_key")).toBe("env-secret");

    const missingEnv = new ChainCredentialStore([new EnvCredentialStore({}), keychain]);
    expect(await missingEnv.get("store", "api_key")).toBe("keychain-secret");
  });

  it("is the default store", async () => {
    const store = createCredentialStore({ PORTOLAN_STORE_API_KEY: "default-secret" });
    expect(await store.get("store", "api_key")).toBe("default-secret");
  });
});
