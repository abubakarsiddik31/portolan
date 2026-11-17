import type { ModelPort, ObjectResult, Usage } from "@abubakarsiddiik/model";
import {
  type ActRequest,
  type ActResult,
  buildRefMap,
  type SemanticNode,
  type Snapshot,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { type RepairDecision, repairIntent } from "./repair.js";

const SEARCH: SemanticNode = {
  nodeId: "q",
  role: "textbox",
  name: "Search",
  backendNodeId: 1,
  ignored: false,
  visible: true,
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  properties: {},
  childIds: [],
};

const GO: SemanticNode = {
  nodeId: "go",
  role: "button",
  name: "Go",
  backendNodeId: 2,
  ignored: false,
  visible: true,
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  properties: {},
  childIds: [],
};

const USAGE: Usage = {
  input: 10,
  cached_input: 0,
  output: 5,
  provider: "fake",
  model: "fake",
};

function refFor(role: string, name: string): string {
  const refs = buildRefMap([SEARCH, GO], 1);
  for (const entry of refs.byRef.values()) {
    if (entry.role === role && entry.name === name) return entry.ref;
  }
  throw new Error(`no ${role} named ${name}`);
}

function fakeSubstrate(): {
  substrate: {
    view(): Promise<SubstrateView>;
    state(): SubstrateView | undefined;
    act(request: ActRequest): Promise<ActResult>;
    read(ref?: string): Promise<{ text: string }>;
  };
  state: () => { value: string; clicked: boolean };
} {
  const refs = buildRefMap([SEARCH, GO], 1);
  const search = refFor("textbox", "Search");
  const go = refFor("button", "Go");

  let value = "";
  let clicked = false;

  const snapshot = (): Snapshot => ({
    doc: 1,
    v: clicked ? 2 : value.length > 0 ? 1 : 0,
    url: clicked ? "http://x/done" : "http://x/",
    title: clicked ? "Done" : "",
    nodes: [SEARCH, GO],
  });

  const view = (): SubstrateView => ({ snapshot: snapshot(), refs });

  return {
    substrate: {
      view: async () => view(),
      state: () => view(),
      act: async (request) => {
        if (request.ref === search && request.do === "fill") {
          value = request.value ?? "";
          return {
            ok: true,
            doc: 1,
            v: 1,
            url: "http://x/",
            title: "",
            effects: [{ kind: "value", backendNodeId: 1, value }],
            delta: { navigation: false, entries: [] },
          };
        }

        if (request.ref === go && request.do === "click") {
          clicked = true;
          return {
            ok: true,
            doc: 1,
            v: 2,
            url: "http://x/done",
            title: "Done",
            effects: [{ kind: "navigation", from: "http://x/", to: "http://x/done", doc: 1 }],
            delta: { navigation: true, entries: [] },
          };
        }

        return { ok: false, code: "invalid_request", message: "unknown action" };
      },
      read: async (ref?: string) => ({ text: ref === undefined ? "page text" : "Search" }),
    },
    state: () => ({ value, clicked }),
  };
}

function scripted(decisions: RepairDecision[]): ModelPort {
  let index = 0;

  return {
    async object<T>(): Promise<ObjectResult<T>> {
      const decision = decisions[index];
      index += 1;
      if (decision === undefined) throw new Error("scripted model ran out of decisions");
      return { value: decision as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the scripted model does not implement agent()");
    },
  };
}

describe("repairIntent", () => {
  it("completes an intent and returns a trace", async () => {
    const { substrate, state } = fakeSubstrate();
    const search = refFor("textbox", "Search");
    const go = refFor("button", "Go");

    const result = await repairIntent({
      model: scripted([
        {
          thought: "Type the query.",
          tool: "act",
          ref: search,
          do: "fill",
          value: "tee",
        },
        { thought: "Submit.", tool: "act", ref: go, do: "click" },
        { thought: "Done.", tool: "done", answer: "Searched for tee." },
      ]),
      substrate,
      goal: "Search for tee and submit",
      effect: "read",
      check: () => state().clicked && state().value === "tee",
    });

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("Searched for tee.");
    expect(result.steps).toHaveLength(3);
    expect(result.usage).toMatchObject({ input: 30, output: 15, provider: "fake" });
    expect(result.trace.effect).toBe("read");
    expect(result.trace.entries.map((entry) => entry.kind)).toEqual(["view", "act", "act"]);
    expect(result.trace.entries[1]).toMatchObject({
      kind: "act",
      ref: search,
      do: "fill",
      value: "tee",
      locator: { role: "textbox", name: "Search", ordinal: 0 },
    });
    expect(result.trace.entries[2]).toMatchObject({
      kind: "act",
      ref: go,
      do: "click",
      delta: { navigation: true },
    });
  });

  it("stops at the step budget", async () => {
    const { substrate } = fakeSubstrate();

    const result = await repairIntent({
      model: scripted([
        { thought: "Look.", tool: "view" },
        { thought: "Look again.", tool: "view" },
      ]),
      substrate,
      goal: "Never finish",
      maxSteps: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("max steps reached");
    expect(result.steps).toHaveLength(2);
    expect(result.trace.entries.map((entry) => entry.kind)).toEqual(["view", "view", "view"]);
  });

  it("rejects a done the check does not confirm", async () => {
    const { substrate } = fakeSubstrate();

    const result = await repairIntent({
      model: scripted([{ thought: "Claim done.", tool: "done", answer: "done" }]),
      substrate,
      goal: "Never finish",
      check: () => false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("success check failed");
  });

  it("feeds a failed act back without recording it", async () => {
    const { substrate } = fakeSubstrate();

    const result = await repairIntent({
      model: scripted([
        { thought: "Try a bad ref.", tool: "act", ref: "nope", do: "click" },
        { thought: "Done.", tool: "done", answer: "stopped" },
      ]),
      substrate,
      goal: "Try once",
    });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.result).toContain("invalid_request");
    expect(result.trace.entries.map((entry) => entry.kind)).toEqual(["view"]);
  });
});
