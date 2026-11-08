import type { ExpandedTask } from "../tasks/load.js";
import type { ToolDef } from "./types.js";

export const RUNNER_SYSTEM = `You are the Portolan benchmark runner.
You complete one web task by calling the tools you are given, one step at a time.
The open_site result is the map: it lists the operations, their signatures and their effects.
Prefer an operation over a fallback. Never invent an operation name.
When the task is complete, return an empty tool name and a short answer in "answer".
Return only the structured object.`;

export function buildObservation(input: {
  task: ExpandedTask;
  step: number;
  maxSteps: number;
  tools: ToolDef[];
  transcript: string[];
  history: "full" | "compact";
}): string {
  const tools = input.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  const transcript = input.history === "full" ? input.transcript : input.transcript.slice(-6);

  return `TASK: ${input.task.goal}
SITE: ${input.task.site}
STEP: ${input.step}/${input.maxSteps}

TOOLS:
${tools}

TRANSCRIPT:
${transcript.join("\n") || "(none)"}

Choose one tool. When the task is complete, return an empty tool name and a short answer.`;
}
