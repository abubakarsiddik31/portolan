import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Trace } from "./fallback.js";
import { TraceStore, toHar } from "./trace.js";

function sample(scopeId = "scope-1"): Trace {
  return {
    scope_id: scopeId,
    sid: "sid-1",
    intent: "place an order",
    effect: "write",
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:00:09.000Z",
    entries: [
      {
        kind: "view",
        at: "2026-01-01T00:00:01.000Z",
        doc: 1,
        v: 0,
        url: "https://shop.test/checkout",
        state: "checkout",
        affordances: 4,
      },
      {
        kind: "act",
        at: "2026-01-01T00:00:02.000Z",
        ref: "e1a2b",
        do: "click",
        locator: { role: "button", name: "Place order", ordinal: 0 },
        doc: 1,
        v: 2,
        url: "https://shop.test/checkout?step=2",
        before_state: "checkout",
        after_state: "order",
        effects: [
          {
            kind: "network",
            method: "POST",
            url: "https://shop.test/api/checkout?x=1",
            status: 201,
            resource_type: "Fetch",
            mime_type: "application/json",
            request_body: { items: [1, 2] },
            response_body: { order: "o_1" },
          },
        ],
        delta: { navigation: false, entries: [] },
      },
      {
        kind: "read",
        at: "2026-01-01T00:00:03.000Z",
        ref: "e1a2b",
        text: "Order o_1",
      },
    ],
  };
}

describe("TraceStore", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "portolan-trace-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reloads a trace losslessly", async () => {
    const store = new TraceStore(dir);
    const trace = sample();

    await store.append(trace);

    expect(await store.get(trace.scope_id)).toEqual(trace);
  });

  it("keeps traces in append order", async () => {
    const store = new TraceStore(dir);

    await store.append(sample("scope-1"));
    await store.append(sample("scope-2"));

    expect((await store.all()).map((trace) => trace.scope_id)).toEqual(["scope-1", "scope-2"]);
  });

  it("returns the last trace for a repeated scope", async () => {
    const store = new TraceStore(dir);
    const first = sample();
    const second = { ...sample(), intent: "retry the order" };

    await store.append(first);
    await store.append(second);

    expect((await store.get(first.scope_id))?.intent).toBe("retry the order");
  });

  it("reads an empty store as no traces", async () => {
    expect(await new TraceStore(dir).all()).toEqual([]);
  });

  it("names the bad line when a trace is corrupt", async () => {
    const store = new TraceStore(dir);
    await store.append(sample());
    await writeFile(join(dir, "traces.jsonl"), "{}\nnot json\n", "utf8");

    await expect(store.all()).rejects.toThrow(/traces\.jsonl:2/);
  });

  it("redacts credentials before writing the JSONL and HAR", async () => {
    const store = new TraceStore(dir);
    const trace = sample();
    trace.entries.push({
      kind: "act",
      at: "2026-01-01T00:00:04.000Z",
      ref: "e9",
      do: "fill",
      value: "hunter2",
      locator: { role: "textbox", name: "Password", ordinal: 0 },
      doc: 1,
      v: 3,
      url: "https://shop.test/login",
      effects: [
        {
          kind: "network",
          method: "POST",
          url: "https://shop.test/login",
          status: 200,
          request_body: { email: "ada@example.com", password: "hunter2" },
        },
      ],
      delta: { navigation: false, entries: [] },
    });

    await store.append(trace);
    const raw = await readFile(join(dir, "traces.jsonl"), "utf8");
    expect(raw).not.toContain("hunter2");
    expect(raw).toContain("[redacted]");

    const harPath = await store.writeHar(trace);
    const har = await readFile(harPath, "utf8");
    expect(har).not.toContain("hunter2");
  });

  it("writes a HAR file next to the trace", async () => {
    const store = new TraceStore(dir);
    const trace = sample();

    const path = await store.writeHar(trace);

    expect(path).toBe(join(dir, `${trace.scope_id}.har`));

    const har = JSON.parse(await readFile(path, "utf8")) as { log: { entries: unknown[] } };
    expect(har.log.entries).toHaveLength(1);
  });
});

describe("toHar", () => {
  it("projects network effects into HAR entries", () => {
    const har = toHar(sample());

    expect(har.log.version).toBe("1.2");
    expect(har.log.creator.name).toBe("portolan");
    expect(har.log.entries).toHaveLength(1);

    const entry = har.log.entries[0];
    expect(entry?.startedDateTime).toBe("2026-01-01T00:00:02.000Z");
    expect(entry?.request).toMatchObject({
      method: "POST",
      url: "https://shop.test/api/checkout?x=1",
      queryString: [{ name: "x", value: "1" }],
      bodySize: 15,
      postData: { mimeType: "application/json", text: '{"items":[1,2]}' },
    });
    expect(entry?.response).toMatchObject({
      status: 201,
      statusText: "Created",
      content: {
        size: 15,
        mimeType: "application/json",
        text: '{"order":"o_1"}',
      },
    });
  });

  it("leaves view and read entries out of HAR", () => {
    const trace = sample();
    trace.entries = trace.entries.filter((entry) => entry.kind !== "act");

    expect(toHar(trace).log.entries).toEqual([]);
  });
});
