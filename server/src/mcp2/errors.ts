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

export class ArchivedConversationError extends Error {
  code: number;
  constructor(message = 'conversation archived') {
    super(message);
    this.name = 'ArchivedConversationError';
    this.code = 410;
  }
}

export class RunInProgressError extends Error {
  code: number;
  data?: unknown;
  constructor(message = 'RUN_IN_PROGRESS', data?: unknown) {
    super(message);
    this.name = 'RunInProgressError';
    this.code = 409;
    this.data = data;
  }
}

export class ProviderUnavailableError extends Error {
  code: number;
  constructor(message = 'CODE_INFO_LLM_UNAVAILABLE') {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.code = -32001;
  }
}

export class ToolExecutionError extends Error {
  code: number;
  data?: unknown;
  constructor(
    code = -32002,
    message = 'TOOL_EXECUTION_FAILED',
    data?: unknown,
  ) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
    this.data = data;
  }
}
