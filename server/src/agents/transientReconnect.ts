export const isTransientReconnect = (message: string | null | undefined) =>
  Boolean(message && /^Reconnecting\.\.\.\s+\d+\/\d+$/.test(message));

export function getErrorMessage(err: unknown): string | undefined {
  if (!err) return undefined;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
  }
  return undefined;
}
