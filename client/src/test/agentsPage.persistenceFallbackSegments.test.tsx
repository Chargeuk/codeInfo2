import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: AgentsPage } = await import('../pages/AgentsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agents', element: <AgentsPage /> },
    ],
  },
];

describe('Agents page - WS required', () => {
  it('shows a WS banner and disables Send when the WebSocket disconnects', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        } as Response);
      }

      if (
        target.includes('/agents') &&
        !target.includes('/commands') &&
        !target.includes('/run')
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'coding_agent' }] }),
        } as Response);
      }

      if (target.includes('/agents/coding_agent/commands')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ commands: [] }),
        } as Response);
      }

      if (target.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: {
          last: () => { readyState: number; close: () => void } | null;
        };
      }
    ).__wsMock;

    await waitFor(() => expect(wsRegistry?.last()?.readyState).toBe(1));

    // Simulate WS disconnect.
    wsRegistry?.last()?.close();

    await screen.findByTestId('agents-ws-banner');

    expect(screen.getByTestId('agent-send')).toBeDisabled();
  });
});
