import { LogEntry } from '@codeinfo2/common';
import { sendLogs } from './transport';

export function createLogger(
  source = 'client',
): (entry: Omit<LogEntry, 'timestamp' | 'source'>) => void {
  return (entry) => {
    const full: LogEntry = {
      timestamp: new Date().toISOString(),
      source,
      ...entry,
    };
    // tee to console for dev ergonomics
    console[entry.level === 'error' ? 'error' : 'log'](full);
    sendLogs([full]);
  };
}
