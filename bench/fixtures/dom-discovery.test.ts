import { discoverDom } from "@abubakarsiddiik/sources";
import { findChrome, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStoreApp } from "./store/v1/app.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe.skipIf(!ENABLED)("DOM discovery on the store fixture", () => {
  let app: FastifyInstance | undefined;
  let base = "";
  let engine: PlaywrightEngine | undefined;

  beforeAll(async () => {
    app = await buildStoreApp();
    base = await listen(app);
  }, 30_000);

  afterAll(async () => {
    await engine?.close();
    await app?.close();
  });

  it("finds pages, nav links, and both read and write forms", async () => {
    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
    const substrate = new Substrate(engine);

    const result = await discoverDom({
      site: "store",
      url: `${base}/`,
      substrate,
      maxPages: 8,
    });

    const names = result.proposals.map((proposal) => proposal.op.name);
    expect(names).toContain("search");
    expect(names.some((name) => name.startsWith("open_"))).toBe(true);
    expect(result.states.some((state) => state.id === "p")).toBe(true);

    const search = result.proposals.find((proposal) => proposal.op.name === "search");
    expect(search?.op.effect).toBe("read");
    expect(search?.op.impls[0]?.tier).toBe("url");

    const write = result.proposals.find((proposal) => proposal.op.effect === "write");
    expect(write?.op.impls[0]?.tier).toBe("ui");
    expect(write?.op.params.properties).toHaveProperty("variant_id");
  }, 60_000);
});
