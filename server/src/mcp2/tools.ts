export type ToolListResult = { tools: ToolDefinition[] };

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export class InvalidParamsError extends Error {
  data?: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = 'InvalidParamsError';
    this.data = data;
  }
}

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool not found: ${name}`);
    this.name = 'ToolNotFoundError';
  }
}

export async function listTools(): Promise<ToolListResult> {
  return { tools: [] };
}

export async function callTool(name: string, args?: unknown) {
  void args;
  throw new ToolNotFoundError(name);
}
