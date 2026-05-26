import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
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

function createMockEventSource() {
  const es = {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onerror: null as (() => void) | null,
    close: jest.fn(),
  } as unknown as EventSource;
  return es;
}

describe('LogsPage layout', () => {
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

  it('renders the shared utility shell and keeps the log controls visible', async () => {
    render(<LogsPage />);

    const shell = await screen.findByTestId('utility-page-shell');

    expect(shell).toBeInTheDocument();
    expect(shell).toHaveAttribute('data-utility-shell-layout', 'data');
    expect(screen.getByLabelText('Search text')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Send sample log' }),
    ).toBeVisible();
    expect(screen.getByText('Live')).toBeVisible();
    expect(screen.getByRole('table', { name: 'Logs table' })).toBeVisible();
    expect(screen.getByTestId('logs-table-scroll-region')).toBeInTheDocument();
  });
});
