import type { ModelPort, Usage } from "@abubakarsiddiik/model";

import type { Arm, RunResult } from "../results/schema.js";
import type { ExpandedTask } from "../tasks/load.js";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export type ToolResult = {
  ok: boolean;
  text: string;
  raw?: unknown;
};

export interface ToolBackend {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  openSite?(site: string): Promise<ToolResult>;
  close(): Promise<void>;
}

export type Decision = {
  thought: string;
  tool: string;
  arguments: Record<string, unknown>;
  answer: string;
};

export type StepRecord = {
  step: number;
  decision: Decision;
  result: ToolResult;
  usage: Usage;
  ms: number;
};

export type Price = {
  inputPer1m: number;
  outputPer1m: number;
};

export interface SuccessChecker {
  check(task: ExpandedTask, steps: StepRecord[]): Promise<{ success: boolean; detail?: string }>;
}

export type RunnerOptions = {
  task: ExpandedTask;
  arm: Arm;
  model: ModelPort;
  backend: ToolBackend;
  provider: string;
  modelId: string;
  maxSteps?: number;
  history?: "full" | "compact";
  price?: Price;
  checker?: SuccessChecker;
  onStep?: (step: StepRecord) => void;
};

export type RunOutcome = {
  result: RunResult;
  steps: StepRecord[];
  success: boolean;
  detail?: string;
};
