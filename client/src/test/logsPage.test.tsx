import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

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
        surface: 'ingest/start',
        code: 'OPENAI_RATE_LIMITED',
        message: 'rate limited',
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
        surface: 'ingest/reembed',
        code: 'LMSTUDIO_UNAVAILABLE',
        message: 'connection failed',
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
    global.fetch = getFetchMock();
    getFetchMock().mockReset();
    getFetchMock().mockResolvedValue(mockJsonResponse(sampleBody));
    global.EventSource = jest.fn(() =>
      createMockEventSource(),
    ) as unknown as typeof EventSource;
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
    const eventSourceMock = global.EventSource as unknown as jest.Mock;
    eventSourceMock.mockReturnValue(es);
    render(<LogsPage />);

    await screen.findByText('sample log');
    fireEvent.click(screen.getByLabelText('Live'));

    await waitFor(() => expect(es.close).toHaveBeenCalled());

    eventSourceMock.mockClear();
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
    getFetchMock().mockResolvedValueOnce(mockJsonResponse(ingestFailureBody));

    render(<LogsPage />);

    const rows = await screen.findAllByText(
      'DEV-0000036:T17:ingest_provider_failure',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getAllByText('WARN').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ERROR').length).toBeGreaterThan(0);
    expect(screen.getByText(/"provider":"openai"/)).toBeVisible();
    expect(screen.getByText(/"surface":"ingest\/start"/)).toBeVisible();
    expect(screen.getByText(/"code":"OPENAI_RATE_LIMITED"/)).toBeVisible();
    expect(screen.getByText(/"message":"rate limited"/)).toBeVisible();
    expect(screen.getByText(/"provider":"lmstudio"/)).toBeVisible();
    expect(screen.getByText(/"surface":"ingest\/reembed"/)).toBeVisible();
    expect(screen.getByText(/"code":"LMSTUDIO_UNAVAILABLE"/)).toBeVisible();
  });
});
