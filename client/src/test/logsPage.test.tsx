import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const logSpy = jest.fn();

await jest.unstable_mockModule('../logging/logger', async () => ({
  __esModule: true,
  createLogger: jest.fn(() => logSpy),
}));

const { default: LogsPage } = await import('../pages/LogsPage');

const sampleBody = {
  items: [
    {
      level: 'info',
      message: 'sample log',
      timestamp: '2025-01-01T00:00:00.000Z',
      source: 'client',
      route: '/logs',
      sequence: 1,
    },
  ],
  lastSequence: 1,
  hasMore: false,
};

const ingestFailureBody = {
  items: [
    {
      level: 'warn',
      message: 'DEV-0000036:T17:ingest_provider_failure',
      timestamp: '2025-01-01T00:00:01.000Z',
      source: 'server',
      sequence: 2,
      context: {
        provider: 'openai',
        code: 'OPENAI_RATE_LIMITED',
        retryable: true,
        stage: 'retry',
        runId: 'run-1',
      },
    },
    {
      level: 'error',
      message: 'DEV-0000036:T17:ingest_provider_failure',
      timestamp: '2025-01-01T00:00:02.000Z',
      source: 'server',
      sequence: 3,
      context: {
        provider: 'lmstudio',
        code: 'LMSTUDIO_UNAVAILABLE',
        retryable: true,
        stage: 'terminal',
        runId: 'run-2',
      },
    },
  ],
  lastSequence: 3,
  hasMore: false,
};

function createMockEventSource() {
  const es = {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onerror: null as (() => void) | null,
    close: jest.fn(),
  } as unknown as EventSource;
  return es;
}

describe('LogsPage', () => {
  const originalFetch = global.fetch;
  const originalEventSource = global.EventSource;

  beforeEach(() => {
    logSpy.mockClear();
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => sampleBody,
      } as Response);
    (global as typeof globalThis & { EventSource: jest.Mock }).EventSource =
      jest.fn(() => createMockEventSource());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource as typeof EventSource;
    jest.clearAllMocks();
  });

  it('renders logs from the API', async () => {
    render(<LogsPage />);

    const logRow = await screen.findByText('sample log');
    expect(logRow).toBeVisible();

    const infoChips = screen.getAllByText('INFO');
    expect(infoChips.length).toBeGreaterThan(0);
    expect(infoChips[0]).toBeVisible();

    const clientChips = screen.getAllByText('client');
    expect(clientChips[clientChips.length - 1]).toBeVisible();
  });

  it('stops streaming when live is toggled off', async () => {
    const es = createMockEventSource();
    (global.EventSource as jest.Mock).mockReturnValue(es);
    render(<LogsPage />);

    await screen.findByText('sample log');
    fireEvent.click(screen.getByLabelText('Live'));

    await waitFor(() => expect(es.close).toHaveBeenCalled());

    (global.EventSource as jest.Mock).mockClear();
    fireEvent.click(screen.getByText('Refresh now'));
    expect(global.EventSource).not.toHaveBeenCalled();
  });

  it('emits a story verification breadcrumb when opened', async () => {
    render(<LogsPage />);

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        'info',
        '0000020 logs page opened',
        expect.anything(),
      ),
    );
  });

  it('renders ingest warning/error logs with provider and code details', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ingestFailureBody,
    } as Response);

    render(<LogsPage />);

    const rows = await screen.findAllByText(
      'DEV-0000036:T17:ingest_provider_failure',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getAllByText('WARN').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ERROR').length).toBeGreaterThan(0);
    expect(screen.getByText(/"provider":"openai"/)).toBeVisible();
    expect(screen.getByText(/"code":"OPENAI_RATE_LIMITED"/)).toBeVisible();
    expect(screen.getByText(/"provider":"lmstudio"/)).toBeVisible();
    expect(screen.getByText(/"code":"LMSTUDIO_UNAVAILABLE"/)).toBeVisible();
  });
});
