import { templateName } from "@abubakarsiddiik/protocol";
import type { SemanticNode, Snapshot, Substrate } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";
import { discoverDom } from "./dom.js";

function node(input: Partial<SemanticNode> & { nodeId: string; role: string }): SemanticNode {
  return {
    name: "",
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
    ...input,
  };
}

function page(url: string, nodes: SemanticNode[]): Snapshot {
  return { doc: 1, v: 1, url, title: url, nodes };
}

const home = page("http://app.test/", [
  node({ nodeId: "root", role: "RootWebArea", name: "Home", childIds: ["form", "cart", "book"] }),
  node({
    nodeId: "form",
    role: "form",
    name: "Search",
    attributes: { method: "get", action: "/search" },
    childIds: ["q", "submit"],
  }),
  node({
    nodeId: "q",
    role: "textbox",
    name: "Search books",
    attributes: { name: "q", type: "search" },
  }),
  node({ nodeId: "submit", role: "button", name: "Search" }),
  node({
    nodeId: "cart",
    role: "link",
    name: "Cart",
    attributes: { href: "/cart" },
  }),
  node({
    nodeId: "book",
    role: "link",
    name: "Compilers at Dawn",
    attributes: { href: "/products/123" },
  }),
]);

const cart = page("http://app.test/cart", [
  node({ nodeId: "root", role: "RootWebArea", name: "Cart", childIds: [] }),
]);

const product = page("http://app.test/products/123", [
  node({ nodeId: "root", role: "RootWebArea", name: "Product", childIds: [] }),
]);

const search = page("http://app.test/search", [
  node({ nodeId: "root", role: "RootWebArea", name: "Search", childIds: [] }),
]);

function fakeSubstrate(visited: string[]): Substrate {
  const pages = new Map([
    ["/", home],
    ["/cart", cart],
    ["/products/123", product],
    ["/search", search],
  ]);

  return {
    goto: async (url: string) => {
      visited.push(url);
      const path = new URL(url).pathname;
      return { snapshot: pages.get(path) ?? home, refs: undefined };
    },
  } as unknown as Substrate;
}

describe("discoverDom", () => {
  it("turns links into url read ops and forms into typed ops", async () => {
    const visited: string[] = [];
    const result = await discoverDom({
      site: "app",
      url: "http://app.test/",
      substrate: fakeSubstrate(visited),
      maxPages: 10,
    });

    expect(result.states.map((state) => state.id).sort()).toEqual(
      ["cart", "home", "products", "search"].sort(),
    );

    const cartOp = result.proposals.find((proposal) => proposal.op.name === "open_cart");
    expect(cartOp?.op).toMatchObject({
      effect: "read",
      from: ["home"],
      to: ["cart"],
      impls: [{ tier: "url", route: "/cart" }],
    });

    const productOp = result.proposals.find((proposal) => proposal.op.name === "open_products");
    expect(productOp?.op.params).toMatchObject({
      required: ["id"],
      properties: { id: { type: "string" } },
    });
    expect(productOp?.op.impls[0]).toMatchObject({ tier: "url", route: "/products/{id}" });

    const searchOp = result.proposals.find((proposal) => proposal.op.name === "search");
    expect(searchOp?.op).toMatchObject({
      effect: "read",
      from: ["home"],
      to: ["search"],
      params: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
        additionalProperties: false,
      },
    });
    expect(searchOp?.op.impls.map((impl) => impl.tier)).toEqual(["url", "ui"]);

    expect(result.tasks).toContainEqual(
      expect.objectContaining({ kind: "add_params", op: "search" }),
    );
    expect(visited).toContain("http://app.test/cart");
    expect(visited).toContain("http://app.test/products/123");

    expect(result.surface).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "link", name: "Cart", target: "cart" }),
        expect.objectContaining({ kind: "form", name: "Search" }),
      ]),
    );
  });

  it("ignores links that are not same-site pages", async () => {
    const pageWithLinks = page("http://app.test/", [
      node({
        nodeId: "root",
        role: "RootWebArea",
        name: "Home",
        childIds: ["linkedin", "pdf", "anchor"],
      }),
      node({
        nodeId: "linkedin",
        role: "link",
        name: "LinkedIn",
        attributes: { href: "linkedin.com/in/ada" },
      }),
      node({
        nodeId: "pdf",
        role: "link",
        name: "Resume PDF",
        attributes: { href: "/resume.pdf" },
      }),
      node({
        nodeId: "anchor",
        role: "link",
        name: "Section",
        attributes: { href: "#features" },
      }),
    ]);

    const result = await discoverDom({
      site: "app",
      url: "http://app.test/",
      substrate: {
        goto: async () => ({ snapshot: pageWithLinks, refs: undefined }),
      } as unknown as Substrate,
      maxPages: 1,
    });

    expect(result.proposals).toEqual([]);
    expect(result.states.map((state) => state.id)).toEqual(["home"]);
  });

  it("treats a form with no method as a write", async () => {
    const loginPage = page("http://app.test/login", [
      node({ nodeId: "root", role: "RootWebArea", name: "Sign in", childIds: ["form"] }),
      node({
        nodeId: "form",
        role: "form",
        name: "Sign in",
        childIds: ["email", "submit"],
      }),
      node({ nodeId: "email", role: "textbox", name: "Email", attributes: { name: "email" } }),
      node({ nodeId: "submit", role: "button", name: "Login" }),
    ]);

    const result = await discoverDom({
      site: "app",
      url: "http://app.test/login",
      substrate: {
        goto: async () => ({ snapshot: loginPage, refs: undefined }),
      } as unknown as Substrate,
      maxPages: 1,
    });

    const login = result.proposals.find((proposal) => proposal.op.name === "login");
    expect(login?.op.effect).toBe("write");
    expect(login?.op.impls.map((impl) => impl.tier)).toEqual(["ui"]);
  });

  it("does not duplicate names or targets already in the map", async () => {
    const result = await discoverDom({
      site: "app",
      url: "http://app.test/",
      substrate: fakeSubstrate([]),
      reserved: { names: ["search"], linkTargets: ["cart"] },
    });

    expect(result.proposals.some((proposal) => proposal.op.name === "search")).toBe(false);
    expect(result.proposals.some((proposal) => proposal.op.name === "open_cart")).toBe(false);
  });

  it("records a button that is disabled as disabled, and enabled once any visit enables it", async () => {
    const withButtons = (disabled: boolean): Snapshot =>
      page("http://app.test/cart", [
        node({ nodeId: "root", role: "RootWebArea", name: "Cart", childIds: ["next", "pay"] }),
        node({ nodeId: "next", role: "button", name: "Next", properties: { disabled: true } }),
        node({ nodeId: "pay", role: "button", name: "Pay", properties: { disabled } }),
      ]);
    const root = page("http://app.test/", [
      node({ nodeId: "root", role: "RootWebArea", name: "Home", childIds: ["l1", "l2"] }),
      node({ nodeId: "l1", role: "link", name: "One", attributes: { href: "/cart" } }),
    ]);
    const substrate = {
      goto: async (url: string) => ({
        snapshot: new URL(url).pathname === "/" ? root : withButtons(false),
        refs: undefined,
      }),
    } as unknown as Substrate;

    const result = await discoverDom({ site: "app", url: "http://app.test/", substrate });
    const byName = new Map(result.surface.map((action) => [action.name, action]));

    expect(byName.get("Next")?.disabled).toBe(true);
    expect(byName.get("Pay")?.disabled).toBeUndefined();
  });
});

describe("templateName", () => {
  it("templates data in a name but keeps a leading number", () => {
    expect(templateName("Active 1")).toBe("Active {count}");
    expect(templateName("Inbox (12)")).toBe("Inbox ({count})");
    expect(templateName("Delete a@x.com")).toBe("Delete {email}");
    expect(templateName("Remove b@y.org from organization")).toBe(
      "Remove {email} from organization",
    );
    expect(templateName("30 days")).toBe("30 days");
    expect(templateName("7")).toBe("7");
    expect(templateName("Save")).toBe("Save");
  });
});

describe("discoverDom layout controls and rows", () => {
  const withLandmark = (path: string, rowEmail: string): Snapshot =>
    page(`http://app.test${path}`, [
      node({ nodeId: "root", role: "RootWebArea", name: path, childIds: ["hdr", "row", "l"] }),
      node({ nodeId: "hdr", role: "banner", name: "", childIds: ["menu"] }),
      node({ nodeId: "menu", role: "button", name: "Account menu" }),
      node({ nodeId: "row", role: "row", name: "", childIds: ["del"] }),
      node({ nodeId: "del", role: "button", name: `Delete ${rowEmail}` }),
      node({ nodeId: "l", role: "link", name: "Next", attributes: { href: "/p2" } }),
    ]);

  it("records the landmark, and collapses rows that differ only by data", async () => {
    const substrate = {
      goto: async (url: string) => ({
        snapshot: withLandmark(new URL(url).pathname === "/" ? "/" : "/p2", "a@x.com"),
        refs: undefined,
      }),
    } as unknown as Substrate;

    const result = await discoverDom({ site: "app", url: "http://app.test/", substrate });
    const menu = result.surface.find((action) => action.name === "Account menu");
    expect(menu?.landmark).toBe("banner");

    const rows = result.surface.filter((action) => action.name.startsWith("Delete"));
    expect(rows.every((action) => action.name === "Delete {email}")).toBe(true);
    expect(rows[0]?.sample).toBe("Delete a@x.com");
  });
});

describe("discoverDom entry points, routes and exploration", () => {
  const shell = (path: string, children: SemanticNode[]): Snapshot =>
    page(`http://app.test${path}`, [
      node({
        nodeId: "root",
        role: "RootWebArea",
        name: path,
        childIds: children.map((child) => child.nodeId),
      }),
      ...children,
    ]);

  it("crawls several entry points in one discovery and reports routes it did not reach", async () => {
    const visited: string[] = [];
    const substrate = {
      goto: async (url: string) => {
        visited.push(new URL(url).pathname);
        return { snapshot: shell(new URL(url).pathname, []), refs: undefined };
      },
    } as unknown as Substrate;

    const result = await discoverDom({
      site: "app",
      url: "http://app.test/admin",
      urls: ["http://app.test/profile"],
      substrate,
      routes: ["/admin", "/profile", "/app/kb/:id/files"],
    });

    expect(visited).toEqual(["/admin", "/profile"]);
    expect(result.pages.sort()).toEqual(["admin", "profile"]);
    expect(result.unreached).toEqual(["/app/kb/:id/files"]);
  });

  it("clicks a safe button, records the route it reaches, and never a blocked one", async () => {
    const buttons = [
      node({ nodeId: "back", role: "button", name: "Back to workspace" }),
      node({ nodeId: "del", role: "button", name: "Delete everything" }),
    ];
    const clicked: string[] = [];
    let at = "/admin";
    const refsFor = (nodes: SemanticNode[]) => ({
      byNode: new Map(nodes.map((n) => [n.nodeId, { ref: `r_${n.nodeId}` }])),
    });
    const substrate = {
      goto: async (url: string) => {
        at = new URL(url).pathname;
        const snapshot = shell(at, at === "/admin" ? buttons : []);
        return { snapshot, refs: refsFor(snapshot.nodes) };
      },
      act: async (request: { ref: string }) => {
        clicked.push(request.ref);
        at = "/app/kb/9";
        return { ok: true, url: `http://app.test${at}` };
      },
    } as unknown as Substrate;

    const result = await discoverDom({
      site: "app",
      url: "http://app.test/admin",
      substrate,
      explore: { safe: (name) => !/delete/i.test(name) },
    });

    expect(clicked).toEqual(["r_back"]);
    const nav = result.proposals.find((proposal) => proposal.op.name === "go_back_to_workspace");
    expect(nav?.op).toMatchObject({
      from: ["admin"],
      effect: "read",
      post: [{ kind: "url", pattern: "^/app/kb/[^/]+$" }],
      impls: [{ tier: "ui", steps: [{ do: "click" }] }],
    });
    expect(result.states.map((state) => state.id)).toContain("app_kb");
  });
});

describe("prefixed ids", () => {
  it("turns /p/p_101 and /p/p_102 into one state", async () => {
    const shell = (path: string, links: string[]): Snapshot =>
      page(`http://app.test${path}`, [
        node({
          nodeId: "root",
          role: "RootWebArea",
          name: path,
          childIds: links.map((l) => `l${l}`),
        }),
        ...links.map((href) =>
          node({ nodeId: `l${href}`, role: "link", name: href, attributes: { href } }),
        ),
      ]);
    const substrate = {
      goto: async (url: string) => {
        const path = new URL(url).pathname;
        return {
          snapshot: shell(path, path === "/" ? ["/p/p_101", "/p/p_102"] : []),
          refs: undefined,
        };
      },
    } as unknown as Substrate;

    const result = await discoverDom({ site: "app", url: "http://app.test/", substrate });
    expect(result.states.map((state) => state.id).sort()).toEqual(["home", "p"]);
  });
});
