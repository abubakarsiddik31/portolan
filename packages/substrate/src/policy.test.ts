import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EgressBlockedError, EgressGuard, isPrivateAddress, loadPolicy } from "./policy.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-policy-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("EgressGuard", () => {
  const guard = new EgressGuard({
    site: "store",
    allow: ["api.example.com", "127.0.0.1:4100", "*.trusted.test"],
    deny: ["evil.trusted.test"],
  });

  it("allows an exact host, a host:port, and a wildcard subdomain", () => {
    expect(guard.allows("https://api.example.com/products")).toBe(true);
    expect(guard.allows("http://127.0.0.1:4100/cart")).toBe(true);
    expect(guard.allows("https://a.trusted.test/")).toBe(true);
  });

  it("defaults to deny and checks deny first", () => {
    expect(guard.allows("https://other.test/")).toBe(false);
    expect(guard.allows("http://127.0.0.1:4101/")).toBe(false);
    expect(guard.allows("https://evil.trusted.test/")).toBe(false);
  });

  it("throws and records a block", () => {
    const events: unknown[] = [];
    const logged = new EgressGuard({ site: "store", allow: ["api.example.com"] }, (event) =>
      events.push(event),
    );

    expect(() => logged.check("https://other.test/", "POST")).toThrow(EgressBlockedError);
    expect(logged.blockedRequests()).toHaveLength(1);
    expect(logged.blockedRequests()[0]).toMatchObject({
      url: "https://other.test/",
      method: "POST",
      reason: "not_allowed",
    });
    expect(events).toHaveLength(1);
  });

  it("records a caller-supplied reason, e.g. a redirect", () => {
    const redirected = new EgressGuard({ site: "store", allow: ["api.example.com"] });

    expect(() => redirected.check("https://other.test/", "GET", "redirect")).toThrow(
      EgressBlockedError,
    );
    expect(redirected.blockedRequests()[0]?.reason).toBe("redirect");
  });

  it("marks a denied host as denied, not merely unlisted", () => {
    const denied = new EgressGuard({
      site: "store",
      allow: ["*.trusted.test"],
      deny: ["evil.trusted.test"],
    });

    expect(() => denied.check("https://evil.trusted.test/")).toThrow(/denied/);
    expect(denied.blockedRequests()[0]?.reason).toBe("denied");
  });
});

describe("address classification", () => {
  it("marks private, loopback, link-local, CGNAT, and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:192.168.1.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("leaves public addresses alone", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.15.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe("EgressGuard.checkResolved", () => {
  it("allows a public name that resolves to a public address", async () => {
    const guard = new EgressGuard(
      { site: "store", allow: ["public.test"] },
      undefined,
      async () => ["93.184.216.34"],
    );

    await expect(guard.checkResolved("https://public.test/api")).resolves.toBeUndefined();
  });

  it("refuses a public name that resolves to a private address", async () => {
    const events: unknown[] = [];
    const guard = new EgressGuard(
      { site: "store", allow: ["public.test"] },
      (event) => events.push(event),
      async () => ["127.0.0.1"],
    );

    await expect(guard.checkResolved("https://public.test/api")).rejects.toThrow(
      EgressBlockedError,
    );
    expect(guard.blockedRequests()[0]?.reason).toBe("private_address");
    expect(events).toHaveLength(1);
  });

  it("trusts an allowlisted IP literal and localhost without a lookup", async () => {
    let lookups = 0;
    const guard = new EgressGuard(
      { site: "store", allow: ["127.0.0.1", "localhost"] },
      undefined,
      async () => {
        lookups += 1;
        return ["10.0.0.1"];
      },
    );

    await expect(guard.checkResolved("http://127.0.0.1/api")).resolves.toBeUndefined();
    await expect(guard.checkResolved("http://localhost/api")).resolves.toBeUndefined();
    expect(lookups).toBe(0);
  });

  it("still refuses an off-allowlist host", async () => {
    const guard = new EgressGuard({ site: "store", allow: ["public.test"] });

    await expect(guard.checkResolved("https://other.test/")).rejects.toThrow(/not_allowed/);
  });
});

describe("loadPolicy", () => {
  it("loads a site policy", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "store.json"),
      JSON.stringify({ site: "store", allow: ["127.0.0.1"], deny: ["ads.example.com"] }),
    );

    expect(loadPolicy("store", dir)).toEqual({
      site: "store",
      allow: ["127.0.0.1"],
      deny: ["ads.example.com"],
    });
  });

  it("returns undefined when the file is missing", () => {
    expect(loadPolicy("missing", tempDir())).toBeUndefined();
  });

  it("rejects an invalid allow list", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "store.json"), JSON.stringify({ site: "store", allow: "all" }));

    expect(() => loadPolicy("store", dir)).toThrow(/allow array/);
  });

  it("rejects a policy for another site", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "store.json"), JSON.stringify({ site: "portal", allow: ["*"] }));

    expect(() => loadPolicy("store", dir)).toThrow(/cannot be loaded/);
  });
});
