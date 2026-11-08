/** JSON Schema as the wire format for op params and returns. */
export type JSONSchema = Record<string, unknown>;

/** The jobs a model does for Portolan: compile, name, repair, or run a task. */
export type ModelRole = "segment" | "name" | "repair" | "runner";

/** Billed usage, normalized across providers. */
export type Usage = {
  input: number;
  cached_input: number;
  output: number;
  provider: string;
  model: string;
};

export type Price = {
  inputPer1m: number;
  outputPer1m: number;
};

export type ObjectRequest = {
  role: ModelRole;
  system: string;
  prompt: string;
  schema: JSONSchema;
  maxTokens?: number;
};

export type ObjectResult<T> = {
  value: T;
  usage: Usage;
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: JSONSchema;
};

export type AgentRequest = {
  role: "repair";
  goal: string;
  tools: ToolDef[];
  maxSteps: number;
};

export type AgentResult = {
  trace: string;
  usage: Usage;
};

export interface ModelPort {
  object<T>(req: ObjectRequest): Promise<ObjectResult<T>>;
  agent(req: AgentRequest): Promise<AgentResult>;
}

export type AnthropicConfig = {
  provider: "anthropic";
  model: string;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  price?: Price;
};

export type OpenAIConfig = {
  provider: "openai";
  model: string;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  price?: Price;
};

export type OpenAICompatibleConfig = {
  provider: "openai-compatible";
  model: string;
  name?: string;
  baseURL: string;
  apiKey?: string;
  maxTokens?: number;
  price?: Price;
};

export type ProviderConfig = AnthropicConfig | OpenAIConfig | OpenAICompatibleConfig;

export type ModelConfig = Record<ModelRole, ProviderConfig>;

export interface ProviderAdapter {
  readonly provider: string;
  readonly model: string;
  object<T>(req: ObjectRequest): Promise<ObjectResult<T>>;
  agent(req: AgentRequest): Promise<AgentResult>;
}

export type ModelPortErrorCode =
  | "missing_api_key"
  | "missing_model"
  | "agent_not_implemented"
  | "no_object_generated"
  | "provider_error";

export class ModelPortError extends Error {
  readonly code: ModelPortErrorCode;

  constructor(code: ModelPortErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelPortError";
    this.code = code;
  }
}

export function wrapProviderError(error: unknown): ModelPortError {
  if (error instanceof ModelPortError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ModelPortError("provider_error", message, { cause: error });
}
