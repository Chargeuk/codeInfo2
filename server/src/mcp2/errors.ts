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
