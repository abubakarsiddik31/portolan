import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EgressBlockedError, EgressGuard, loadPolicy } from "./policy.js";

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
