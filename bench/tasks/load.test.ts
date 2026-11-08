import { describe, expect, it } from "vitest";

import { expandTask, loadTasks, loadTaskTemplates } from "./load.js";

describe("task templates", () => {
  it("loads three templates per site", () => {
    const templates = loadTaskTemplates();
    expect(templates).toHaveLength(9);
    for (const site of ["store", "wizard", "portal"] as const) {
      expect(templates.filter((template) => template.site === site)).toHaveLength(3);
    }
  });

  it("expands to five tasks per template", () => {
    const tasks = loadTasks();
    expect(tasks).toHaveLength(45);
    expect(new Set(tasks.map((task) => task.template_id)).size).toBe(9);
  });

  it("gives every expanded task a unique id", () => {
    const ids = loadTasks().map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves no placeholders after expansion", () => {
    for (const task of loadTasks()) {
      const strings = [
        task.goal,
        task.success.url_matches ?? "",
        task.success.dom ?? "",
        ...Object.values(task.success.extracted ?? {}),
        task.success.download?.filename_matches ?? "",
        task.success.download?.contains ?? "",
      ];
      for (const value of strings) {
        expect(value).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
      }
    }
  });

  it("throws when a placeholder has no value", () => {
    const [template] = loadTaskTemplates();
    if (!template) throw new Error("expected at least one template");
    expect(() => expandTask(template, {})).toThrow(/missing task param/);
  });

  it("keeps every start path relative", () => {
    for (const template of loadTaskTemplates()) {
      expect(template.start.startsWith("/")).toBe(true);
    }
  });
});
