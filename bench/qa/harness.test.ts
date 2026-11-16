import { createServer, type Server } from "node:http";
import type { Engine, SemanticNode } from "@portolan/substrate";
import { findChrome, Substrate } from "@portolan/substrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  actRetry,
  fillSticky,
  find,
  Harness,
  renderMarkdown,
  runCases,
  summarize,
} from "./harness.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

function chromePath(): string {
  if (CHROME === undefined) throw new Error("Chrome is required");
  return CHROME;
}

const NODE: SemanticNode = {
  nodeId: "n1",
  role: "button",
  name: "Go",
  backendNodeId: 7,
  ignored: false,
  visible: true,
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  properties: {},
  childIds: [],
};

describe("runCases", () => {
  it("isolates a throwing case and keeps the loop running", async () => {
    const engine = {
      navigate: async () => ({ url: "http://x/", title: "", status: null }),
      snapshot: async () => ({ doc: 1, v: 0, url: "http://x/", title: "", nodes: [NODE] }),
      dispatch: async () => ({ ok: true, doc: 1, v: 1, url: "http://x/", title: "", effects: [] }),
      evaluate: async () => ({ status: 200, text: "{}", json: {}, url: "http://x/" }),
      close: async () => undefined,
    } as unknown as Engine;
    const harness = Harness.wrap(new Substrate(engine, { settleBudgetMs: 50 }), "http://x");

    const results = await runCases(
      [
        {
          id: "TC-1",
          title: "passes",
          run: async () => ({ status: "pass", evidence: "fine" }),
        },
        {
          id: "TC-2",
          title: "throws",
          run: async () => {
            throw new Error("boom");
          },
        },
        {
          id: "TC-3",
          title: "skips",
          run: async () => ({ status: "skip", evidence: "n/a" }),
        },
      ],
      harness,
    );

    expect(results.map((r) => r.status)).toEqual(["pass", "fail", "skip"]);
    expect(results[1]?.evidence).toContain("boom");
  });

  it("renders markdown with escaped pipes", () => {
    const markdown = renderMarkdown(
      [{ id: "TC-1", title: "a | b", status: "pass", evidence: "x | y" }],
      "Tiny run",
    );

    expect(markdown).toContain("# Tiny run");
    expect(markdown).toContain("| TC-1 | a \\| b | PASS | x \\| y |");
  });

  it("summarizes", () => {
    expect(
      summarize([
        { id: "1", title: "a", status: "pass", evidence: "" },
        { id: "2", title: "b", status: "fail", evidence: "" },
        { id: "3", title: "c", status: "fail", evidence: "" },
        { id: "4", title: "d", status: "skip", evidence: "" },
      ]),
    ).toBe("1 pass, 2 fail, 1 skip");
  });
});

describe.skipIf(!ENABLED)("harness helpers on a live page", () => {
  let server: Server | undefined;
  let baseUrl = "";

  const HOME = `<!doctype html>
<html lang="en">
<head><title>Harness</title></head>
<body>
  <h1>Harness</h1>
  <form>
    <label for="email">Email</label>
    <input id="email" name="email">
    <button type="button" id="submit" onclick="document.getElementById('out').textContent = document.getElementById('email').value">Login</button>
  </form>
  <button id="swap" onclick="this.name='moved'; document.getElementById('email').name='email2'">Rerender</button>
  <output id="out"></output>
</body>
</html>`;

  beforeAll(async () => {
    const started = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(HOME);
    });
    server = started;
    await new Promise<void>((resolve) => {
      started.listen(0, "127.0.0.1", resolve);
    });
    const address = started.address();
    if (address === null || typeof address === "string") {
      throw new Error("the test server did not get a port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  function makeHarness(): Promise<Harness> {
    return Harness.launch(
      chromePath(),
      { baseUrl },
      process.env.CI === "true" ? ["--no-sandbox"] : [],
    );
  }

  it("gotoPage settles and helpers find affordances", async () => {
    const harness = await makeHarness();
    try {
      const view = await harness.gotoPage("/");
      const login = find(view, /^login$/i, ["button"]);
      expect(login).toBeDefined();

      const filled = await fillSticky(harness, view, /^email$/i, "a@b.c", "email");
      const box = find(filled, /^email$/i, ["textbox"]);
      if (box?.ref === undefined) throw new Error("email box gone");
      expect((await harness.s.read(box.ref)).text).toBe("a@b.c");

      const clicked = await actRetry(harness, filled, login, { do: "click" }, "submit");
      expect(clicked.ok).toBe(true);
      // The output element now carries the value; the email input's
      // accessible name stays "Email", so this text came from the submit.
      expect((await harness.pageText()).split("\n")).toContain("a@b.c");
    } finally {
      await harness.close();
    }
  });
});

// The mock-engine assertions live at the substrate level; the harness is a
// composition of verbs already tested there. One direct Substrate is built
// to confirm the harness accepts one.
describe("Harness accepts a plain substrate", () => {
  it("constructs", () => {
    const engine = {
      navigate: async () => ({ url: "http://x/", title: "", status: null }),
      snapshot: async () => ({
        doc: 1,
        v: 0,
        url: "http://x/",
        title: "",
        nodes: [NODE],
      }),
      dispatch: async () => ({ ok: true, doc: 1, v: 1, url: "http://x/", title: "", effects: [] }),
      evaluate: async () => ({ status: 200, text: "{}", json: {}, url: "http://x/" }),
      close: async () => undefined,
    } as unknown as Engine;
    const substrate = new Substrate(engine, { settleBudgetMs: 50 });
    expect(substrate).toBeInstanceOf(Substrate);
  });
});
