import { jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { WebSocketMockRegistry } from './support/mockWebSocket';

const mockFetch = jest.fn();

const { default: App } = await import('../App');
const { default: HomePage } = await import('../pages/HomePage');
const { default: IngestPage } = await import('../pages/IngestPage');

const ingestRoutes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'ingest', element: <IngestPage /> },
    ],
  },
];

function wsRegistry(): WebSocketMockRegistry {
  const registry = (
    globalThis as unknown as { __wsMock?: WebSocketMockRegistry }
  ).__wsMock;
  if (!registry) {
    throw new Error('Missing __wsMock registry; is setupTests.ts running?');
  }
  return registry;
}

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/ingest/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [], lockedModelId: undefined }),
      };
    }
    if (url.includes('/ingest/roots')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ roots: [], lockedModelId: undefined }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    };
  });
  wsRegistry().reset();
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('Ingest page layout', () => {
  it('renders inside the shared utility shell without the old maxWidth container class', async () => {
    const router = createMemoryRouter(ingestRoutes, {
      initialEntries: ['/ingest'],
    });
    render(<RouterProvider router={router} />);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(await screen.findByTestId('utility-page-shell')).toBeInTheDocument();
    expect(document.querySelector('.MuiContainer-maxWidthLg')).toBeNull();
  });

  it('renders a degraded queue-read warning while keeping visible roots on the page', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ingest/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [], lockedModelId: undefined }),
        };
      }
      if (url.includes('/ingest/roots')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            roots: [
              {
                runId: 'run-1',
                name: 'repo',
                path: '/repo',
                model: 'embed-model',
                status: 'completed',
                lastIngestAt: '2025-01-01T00:00:00.000Z',
                counts: { files: 2, chunks: 4, embedded: 4 },
                lastError: null,
              },
            ],
            lockedModelId: 'embed-model',
            queueReadDegraded: true,
            queueReadError: {
              error: 'QUEUE_READ_DEGRADED',
              message:
                'Queue-backed repository visibility may be incomplete because Mongo queue reads are unavailable.',
              retryable: true,
              provider: 'ingest',
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      };
    });

    const router = createMemoryRouter(ingestRoutes, {
      initialEntries: ['/ingest'],
    });
    render(<RouterProvider router={router} />);

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(await screen.findByText('repo')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Queue-backed repository visibility may be incomplete because Mongo queue reads are unavailable.',
      ),
    ).toBeInTheDocument();
  });
});
