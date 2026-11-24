import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { ActivityFeed } from "./activity.js";
import { startWatchServer, type WatchServerHandle } from "./watch.js";

function get(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; type: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          type: response.headers["content-type"],
          body,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** Read server-sent events until `count` data lines arrive. */
function readEvents(url: string, count: number, after?: () => void): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    const req = request(url, (response) => {
      let buffer = "";
      after?.();
      response.on("data", (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
          index = buffer.indexOf("\n\n");
        }
        if (events.length >= count) {
          req.destroy();
          resolve(events);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("watch server", () => {
  let handle: WatchServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("serves the viewer on a loopback address", async () => {
    handle = await startWatchServer({ feed: new ActivityFeed(), port: 0 });

    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await get(`${handle.url}/`);
    expect(page.status).toBe(200);
    expect(page.type).toContain("text/html");
    expect(page.body).toContain("Portolan watch");
  });

  it("refuses a request addressed to another host name", async () => {
    handle = await startWatchServer({ feed: new ActivityFeed(), port: 0 });

    const page = await get(`${handle.url}/events`, { host: "attacker.example" });
    expect(page.status).toBe(403);
  });

  it("replays recent activity, then streams new events", async () => {
    const feed = new ActivityFeed();
    const id = feed.call("open_site", { site: "store" });
    feed.result(id, "open_site", { content: [{ type: "text", text: "{}" }] }, 3);
    handle = await startWatchServer({ feed, port: 0 });

    const events = await readEvents(`${handle.url}/events`, 3, () => {
      setTimeout(() => feed.frame("s1", "AAAA", 800, 600), 20);
    });

    expect(events).toMatchObject([
      { kind: "call", tool: "open_site" },
      { kind: "result", tool: "open_site", ok: true },
      { kind: "frame", sid: "s1", data: "AAAA" },
    ]);
  });

  it("moves to the next port when the first is taken", async () => {
    const first = await startWatchServer({ feed: new ActivityFeed(), port: 0 });
    const port = Number(new URL(first.url).port);
    try {
      handle = await startWatchServer({ feed: new ActivityFeed(), port });
      expect(Number(new URL(handle.url).port)).toBeGreaterThan(port);
    } finally {
      await first.close();
    }
  });
});
