import { jest } from '@jest/globals';
import { act, render } from '@testing-library/react';
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
  it('does not apply the default maxWidth container class', () => {
    const router = createMemoryRouter(ingestRoutes, {
      initialEntries: ['/ingest'],
    });
    render(<RouterProvider router={router} />);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(document.querySelector('.MuiContainer-maxWidthLg')).toBeNull();
  });
});
