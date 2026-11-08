import { describe, expect, it } from "vitest";

import { BrowserRegistry } from "./browsers.js";

describe("BrowserRegistry", () => {
  it("closes one engine and forgets it", async () => {
    const registry = new BrowserRegistry();
    const closed: string[] = [];
    registry.register("a", { close: () => void closed.push("a") });
    registry.register("b", { close: () => void closed.push("b") });

    await registry.close("a");

    expect(closed).toEqual(["a"]);
    expect(registry.size()).toBe(1);
  });

  it("ignores an unknown sid", async () => {
    const registry = new BrowserRegistry();
    await expect(registry.close("nope")).resolves.toBeUndefined();
  });

  it("closes every engine even when one throws", async () => {
    const registry = new BrowserRegistry();
    const closed: string[] = [];
    registry.register("ok", { close: () => void closed.push("ok") });
    registry.register("bad", {
      close: () => {
        throw new Error("browser already gone");
      },
    });
    registry.register("late", { close: async () => void closed.push("late") });

    await registry.closeAll();

    expect(closed.sort()).toEqual(["late", "ok"]);
    expect(registry.size()).toBe(0);
  });

  it("replaces a registration for the same session", async () => {
    const registry = new BrowserRegistry();
    const closed: string[] = [];
    registry.register("a", { close: () => void closed.push("first") });
    registry.register("a", { close: () => void closed.push("second") });

    expect(registry.size()).toBe(1);
    await registry.close("a");
    expect(closed).toEqual(["second"]);
  });
});
