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
});
