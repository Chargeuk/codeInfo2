export class CodexUnavailableError extends Error {
  reason?: string;
  constructor(reason?: string) {
    super('CODEX_UNAVAILABLE');
    this.name = 'CodexUnavailableError';
    this.reason = reason;
  }
}
