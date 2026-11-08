import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { type TaskSuccess, type TaskTemplate, taskFileSchema } from "./schema.js";

export type ExpandedTask = Omit<TaskTemplate, "id" | "params"> & {
  id: string;
  template_id: string;
  values: Record<string, string>;
};

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`missing task param "${key}"`);
    return value;
  });
}

function fillSuccess(success: TaskSuccess, values: Record<string, string>): TaskSuccess {
  return {
    ...(success.url_matches ? { url_matches: fill(success.url_matches, values) } : {}),
    ...(success.dom ? { dom: fill(success.dom, values) } : {}),
    ...(success.extracted
      ? {
          extracted: Object.fromEntries(
            Object.entries(success.extracted).map(([key, selector]) => [
              key,
              fill(selector, values),
            ]),
          ),
        }
      : {}),
    ...(success.download
      ? {
          download: {
            ...(success.download.filename_matches
              ? { filename_matches: fill(success.download.filename_matches, values) }
              : {}),
            ...(success.download.contains
              ? { contains: fill(success.download.contains, values) }
              : {}),
          },
        }
      : {}),
  };
}

export function expandTask(
  template: TaskTemplate,
  values: Record<string, string>,
  index = 0,
): ExpandedTask {
  const { id, params: _params, ...rest } = template;
  return {
    ...rest,
    id: `${id}#${index + 1}`,
    template_id: id,
    values,
    goal: fill(template.goal, values),
    success: fillSuccess(template.success, values),
  };
}

export function loadTaskTemplates(dir = "bench/tasks/dev"): TaskTemplate[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort();
  const templates: TaskTemplate[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(join(dir, file), "utf8"));
    const parsed = taskFileSchema.parse(raw);
    for (const template of parsed.templates) {
      templates.push({ ...template, site: parsed.site });
    }
  }

  return templates;
}

export function loadTasks(dir = "bench/tasks/dev"): ExpandedTask[] {
  return loadTaskTemplates(dir).flatMap((template) =>
    template.params.map((values, index) => expandTask(template, values, index)),
  );
}
