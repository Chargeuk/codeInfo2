import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LogsPage from '../pages/LogsPage';

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

describe('LogsPage', () => {
  const originalFetch = global.fetch;
  const originalEventSource = global.EventSource;

  beforeEach(() => {
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
});
