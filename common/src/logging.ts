export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string; // ISO string
  source: 'server' | 'client' | 'client-flows';
  requestId?: string;
  correlationId?: string;
  userAgent?: string;
  url?: string;
  route?: string;
  tags?: string[];
  context?: Record<string, unknown>;
  sequence?: number;
};

export function isLogEntry(value: unknown): value is LogEntry {
  const v = value as Partial<LogEntry>;
  return (
    !!v &&
    ['error', 'warn', 'info', 'debug'].includes(v.level as string) &&
    typeof v.message === 'string'
  );
}
