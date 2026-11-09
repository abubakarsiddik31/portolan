import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const wrapper = readFileSync(join(ROOT, "docker/chromium.sh"), "utf8");
const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
const packaging = readFileSync(join(ROOT, "docs/PACKAGING.md"), "utf8");

describe("chromium sandbox", () => {
  it("defaults to no-sandbox and lets the host turn the sandbox on", () => {
    expect(wrapper).toContain("PORTOLAN_CHROME_SANDBOX");
    expect(wrapper).toContain("--no-sandbox");
    expect(wrapper).toContain("--disable-dev-shm-usage");
    expect(wrapper).toContain("/usr/bin/chromium");
  });

  it("the image uses the wrapper and exposes the switch", () => {
    expect(dockerfile).toContain("docker/chromium.sh");
    expect(dockerfile).toContain("CHROME_PATH=/usr/local/bin/chromium-portolan");
    expect(dockerfile).toContain("PORTOLAN_CHROME_SANDBOX=0");
  });

  it("the compose example turns the sandbox on with a seccomp profile", () => {
    expect(compose).toContain('PORTOLAN_CHROME_SANDBOX: "1"');
    expect(compose).toContain("seccomp=unconfined");
  });

  it("the docs say the default image is trusted-sites only", () => {
    expect(packaging).toContain("trusted sites");
    expect(packaging).toContain("PORTOLAN_CHROME_SANDBOX=1");
  });
});
