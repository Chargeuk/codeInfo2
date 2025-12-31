import { jest } from '@jest/globals';

const logQueue: unknown[] = [];

await jest.unstable_mockModule('../logging/transport', async () => ({
  __esModule: true,
  sendLogs: (entries: unknown[]) => logQueue.push(...entries),
}));

const {
  createLogger,
  resolveStableClientId,
  _resetClientIdForTests,
}: typeof import('../logging/logger') = await import('../logging/logger');

describe('client logging', () => {
  beforeEach(() => {
    logQueue.length = 0;
    localStorage.clear();
    _resetClientIdForTests();
  });

  it('adds a stable clientId to every log entry', () => {
    const logA = createLogger('client', () => '/chat');
    const logB = createLogger('client', () => '/logs');

    logA('info', 'chat.ws.client_test_a');
    logB('info', 'chat.ws.client_test_b');

    expect(logQueue).toHaveLength(2);
    const [entryA, entryB] = logQueue as Array<{
      context?: Record<string, unknown>;
    }>;
    const clientIdA = entryA.context?.clientId;
    const clientIdB = entryB.context?.clientId;

    expect(typeof clientIdA).toBe('string');
    expect(clientIdA).toBe(clientIdB);
    expect(localStorage.getItem('codeinfo2.clientId')).toBe(clientIdA);
  });

  it('falls back to an in-memory clientId when storage is unavailable', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    const first = resolveStableClientId({ storage: throwingStorage });
    const second = resolveStableClientId({ storage: throwingStorage });

    expect(typeof first).toBe('string');
    expect(first).toBe(second);
  });
});
