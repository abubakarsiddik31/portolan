import type { PlaywrightEngine } from "@abubakarsiddiik/substrate";

import type { ScriptStep } from "../repair/scripted-model.js";
import type { ToolBackend } from "../runner/types.js";
import type { ExpandedTask } from "./load.js";

export function evaluateBackend(engine: PlaywrightEngine): ToolBackend {
  return {
    async listTools() {
      return [];
    },
    async callTool(name, args) {
      if (name !== "evaluate") return { ok: false, text: `unknown tool "${name}"` };
      const value = await engine.evaluate<unknown>(String(args.expression));
      return { ok: true, text: JSON.stringify({ ok: true, value }) };
    },
    async close() {
      // The caller owns the engine.
    },
  };
}

function loginSteps(): ScriptStep[] {
  return [
    {
      kind: "act",
      role: "textbox",
      name: "Email",
      do: "fill",
      value: "agent@example.com",
    },
    { kind: "act", role: "textbox", name: "Password", do: "fill", value: "support" },
    { kind: "act", role: "button", name: "Sign in", do: "click" },
  ];
}

export function scriptFor(task: ExpandedTask): ScriptStep[] {
  const values = task.values;
  const done: ScriptStep = { kind: "done", answer: "Done." };

  switch (task.template_id) {
    case "library-search-open":
    case "library-author":
    case "library-genre":
    case "library-availability":
    case "library-back": {
      const query = values.query ?? values.author ?? values.genre ?? "";
      const steps: ScriptStep[] = [
        { kind: "act", role: "textbox", name: "Search books", do: "fill", value: query },
        { kind: "act", role: "button", name: "Search", do: "click" },
        { kind: "act", role: "link", name: values.title ?? "", do: "click" },
      ];

      if (task.template_id === "library-back") {
        steps.push({ kind: "act", role: "link", name: "← Back to catalog", do: "click" });
      }

      return [...steps, done];
    }
    case "library-borrow":
      return [
        {
          kind: "act",
          role: "textbox",
          name: "Search books",
          do: "fill",
          value: values.query ?? "",
        },
        { kind: "act", role: "button", name: "Search", do: "click" },
        { kind: "act", role: "link", name: values.title ?? "", do: "click" },
        { kind: "act", role: "button", name: "Borrow", do: "click" },
        done,
      ];
    case "library-search-miss":
      return [
        {
          kind: "act",
          role: "textbox",
          name: "Search books",
          do: "fill",
          value: values.query ?? "",
        },
        { kind: "act", role: "button", name: "Search", do: "click" },
        done,
      ];
    case "library-loans-empty":
      return [{ kind: "act", role: "link", name: "Loans (0)", do: "click" }, done];
    case "support-login":
      return [...loginSteps(), done];
    case "support-filter":
      return [
        ...loginSteps(),
        {
          kind: "act",
          role: "combobox",
          name: "Status",
          do: "select",
          value: values.status ?? "open",
        },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        done,
      ];
    case "support-filter-search":
      return [
        ...loginSteps(),
        {
          kind: "act",
          role: "textbox",
          name: "Search",
          do: "fill",
          value: values.query ?? "",
        },
        {
          kind: "act",
          role: "combobox",
          name: "Status",
          do: "select",
          value: values.status ?? "open",
        },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        done,
      ];
    case "support-search":
    case "support-search-miss":
      return [
        ...loginSteps(),
        {
          kind: "act",
          role: "textbox",
          name: "Search",
          do: "fill",
          value: values.query ?? "",
        },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        done,
      ];
    case "support-paginate":
      return [...loginSteps(), { kind: "act", role: "link", name: "Next", do: "click" }, done];
    case "support-open-ticket":
      return [
        ...loginSteps(),
        { kind: "act", role: "link", name: values.subject ?? "", do: "click" },
        done,
      ];
    case "support-create":
      return [
        ...loginSteps(),
        { kind: "act", role: "link", name: "Create ticket", do: "click" },
        {
          kind: "act",
          role: "textbox",
          name: "Subject",
          do: "fill",
          value: values.subject ?? "",
        },
        {
          kind: "act",
          role: "combobox",
          name: "Priority",
          do: "select",
          value: values.priority ?? "normal",
        },
        { kind: "act", role: "button", name: "Create ticket", do: "click" },
        done,
      ];
    default:
      throw new Error(`no script for ${task.template_id}`);
  }
}
