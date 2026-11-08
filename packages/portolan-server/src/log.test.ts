import { describe, expect, it } from "vitest";

import { createLogger } from "./log.js";

function collector(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => void lines.push(line) };
}

describe("createLogger", () => {
  it("writes one JSON object per line", () => {
    const sink = collector();
    const log = createLogger({
      write: sink.write,
      now: () => new Date("2026-11-09T12:00:00Z"),
    });

    log.info("session.created", { sid: "s1", site: "store" });

    expect(sink.lines).toHaveLength(1);
    expect(JSON.parse(sink.lines[0] ?? "")).toEqual({
      ts: "2026-11-09T12:00:00.000Z",
      level: "info",
      event: "session.created",
      sid: "s1",
      site: "store",
    });
  });

  it("drops lines below the level", () => {
    const sink = collector();
    const log = createLogger({ level: "warn", write: sink.write });

    log.debug("noise");
    log.info("noise");
    log.warn("kept");
    log.error("kept");

    expect(sink.lines).toHaveLength(2);
    expect(sink.lines.map((line) => JSON.parse(line).level)).toEqual(["warn", "error"]);
  });

  it("redacts a sensitive key, including nested values", () => {
    const sink = collector();
    const log = createLogger({ write: sink.write });

    log.info("login", {
      password: "hunter2",
      request: { token: "abc", user: "ada" },
      items: [{ api_key: "k" }],
    });

    const line = sink.lines[0] ?? "";
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("abc");
    expect(JSON.parse(line)).toMatchObject({
      password: "[redacted]",
      request: { token: "[redacted]", user: "ada" },
      items: [{ api_key: "[redacted]" }],
    });
  });

  it("merges child fields into every line", () => {
    const sink = collector();
    const log = createLogger({ write: sink.write, base: { service: "portolan-server" } });
    const child = log.child({ sid: "s1" });

    child.info("a", { n: 1 });
    child.warn("b");

    expect(JSON.parse(sink.lines[0] ?? "")).toMatchObject({
      service: "portolan-server",
      sid: "s1",
      n: 1,
    });
    expect(JSON.parse(sink.lines[1] ?? "")).toMatchObject({
      service: "portolan-server",
      sid: "s1",
      level: "warn",
    });
  });

  it("redacts child fields", () => {
    const sink = collector();
    const log = createLogger({ write: sink.write }).child({ secret: "value" });

    log.info("x");

    expect(JSON.parse(sink.lines[0] ?? "")).toMatchObject({ secret: "[redacted]" });
  });
});
