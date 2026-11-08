import type { ModelPort, ObjectResult, Usage } from "@portolan/model";
import {
  buildRefMap,
  type SemanticNode,
  type Snapshot,
  type SubstrateView,
} from "@portolan/substrate";
import { describe, expect, it } from "vitest";

import { inferReturns, nameReturns, validateInferredReturns } from "./returns.js";

const USAGE: Usage = {
  input: 10,
  cached_input: 0,
  output: 5,
  provider: "fake",
  model: "fake",
};

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

function view(nodes: SemanticNode[]): SubstrateView {
  const snapshot: Snapshot = {
    doc: 1,
    v: 1,
    url: "http://x/",
    title: "",
    nodes,
  };

  return { snapshot, refs: buildRefMap(nodes, 1) };
}

function invoiceView(status: string, ids: string[]): SubstrateView {
  const headers = ["Invoice", "Vendor", "Category", "Amount", "Status", "Date"];
  const headerRow = node({
    nodeId: "hr",
    role: "row",
    childIds: headers.map((_, index) => `h${index}`),
  });
  const headerNodes = headers.map((name, index) =>
    node({ nodeId: `h${index}`, role: "columnheader", name }),
  );

  const rows = ids.map((id, rowIndex) => {
    const cells = [id, "Acme", "software", "$10.00", status, "2026-01-01"];
    const cellNodes = cells.map((name, index) =>
      node({
        nodeId: `r${rowIndex}c${index}`,
        role: "cell",
        name,
        ...(index === 4 ? { attributes: { "data-status": status } } : {}),
      }),
    );

    return {
      row: node({
        nodeId: `r${rowIndex}`,
        role: "row",
        test_id: "invoice-row",
        childIds: cellNodes.map((cell) => cell.nodeId),
      }),
      cells: cellNodes,
    };
  });

  const table = node({
    nodeId: "table",
    role: "table",
    test_id: "invoice-table",
    childIds: [headerRow.nodeId, ...rows.map((row) => row.row.nodeId)],
  });

  return view([
    table,
    headerRow,
    ...headerNodes,
    ...rows.flatMap((row) => [row.row, ...row.cells]),
  ]);
}

function orderView(orderId: string): SubstrateView {
  return view([
    node({ nodeId: "h", role: "heading", name: "Order confirmed" }),
    node({ nodeId: "o", role: "strong", name: orderId, test_id: "order-id" }),
  ]);
}

function scriptedNames(fields: Record<string, string>): ModelPort {
  return {
    async object<T>(): Promise<ObjectResult<T>> {
      return { value: { fields } as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the name model does not implement agent()");
    },
  };
}

describe("inferReturns", () => {
  it("infers rows from a table and validates a held-back run", () => {
    const inferred = inferReturns(invoiceView("paid", ["inv_1001", "inv_1004"]));

    expect(inferred.kind).toBe("rows");
    expect(inferred.extractor).toMatchObject({
      kind: "rows",
      container: { test_id: "invoice-table" },
      row: { test_id: "invoice-row" },
    });
    expect(inferred.value).toHaveLength(2);
    expect(inferred.schema).toMatchObject({ type: "array" });

    const heldBack = invoiceView("pending", ["inv_1002"]);
    expect(validateInferredReturns(inferred, heldBack)).toMatchObject({ ok: true });
  });

  it("infers fields from a test id and validates a different order", () => {
    const inferred = inferReturns(orderView("ord_1001"));

    expect(inferred.kind).toBe("fields");
    expect(inferred.extractor).toEqual({
      kind: "fields",
      fields: { order_id: { test_id: "order-id", attr: "text" } },
    });
    expect(inferred.value).toEqual({ order_id: "ord_1001" });
    expect(validateInferredReturns(inferred, orderView("ord_1002"))).toMatchObject({ ok: true });
  });

  it("returns none when the page has no data region", () => {
    const inferred = inferReturns(view([node({ nodeId: "h", role: "heading", name: "Sign in" })]));

    expect(inferred.kind).toBe("none");
    expect(inferred.extractor).toEqual({ kind: "none" });
  });
});

describe("nameReturns", () => {
  it("renames the extractor, value, and schema together", async () => {
    const inferred = inferReturns(invoiceView("paid", ["inv_1001"]));

    const named = await nameReturns({
      model: scriptedNames({ invoice: "id", amount: "total" }),
      inferred,
    });

    expect(named.renames).toEqual({ invoice: "id", amount: "total" });
    expect(named.inferred.extractor).toMatchObject({
      kind: "rows",
      cols: {
        id: { role: "cell", ordinal: 0 },
        total: { role: "cell", ordinal: 3 },
      },
    });
    expect(named.inferred.schema).toMatchObject({
      type: "array",
      items: { properties: { id: { type: "string" }, total: { type: "string" } } },
    });
    expect(named.inferred.value).toEqual([
      expect.objectContaining({ id: "inv_1001", total: "$10.00" }),
    ]);
  });

  it("rejects a name that is not snake case", async () => {
    const inferred = inferReturns(invoiceView("paid", ["inv_1001"]));

    await expect(
      nameReturns({ model: scriptedNames({ invoice: "Invoice ID" }), inferred }),
    ).rejects.toThrow(/snake_case/);
  });

  it("rejects a name the model invented", async () => {
    const inferred = inferReturns(invoiceView("paid", ["inv_1001"]));

    await expect(nameReturns({ model: scriptedNames({ nope: "id" }), inferred })).rejects.toThrow(
      /unknown field/,
    );
  });
});
