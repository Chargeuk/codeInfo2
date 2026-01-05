import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('Agents page - instruction start errors', () => {
  it('shows an error banner and keeps Stop disabled for RUN_IN_PROGRESS', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          } as Response);
        }

        if (target.includes('/agents') && !target.includes('/run')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          return Promise.resolve({
            ok: false,
            status: 409,
            headers: { get: () => 'application/json' },
            json: async () => ({
              error: 'conflict',
              code: 'RUN_IN_PROGRESS',
              message: 'A run is already in progress for this conversation.',
            }),
          } as unknown as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const input = await screen.findByTestId('agent-input');
    await user.type(input, 'Question');

    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await screen.findByTestId('agents-run-error');
    expect(screen.getByTestId('agents-run-error')).toHaveTextContent(
      'run in progress',
    );

    // Stop remains disabled because no WS inflight started.
    expect(screen.getByTestId('agent-stop')).toBeDisabled();
  });

  it('shows an error banner for AGENT_NOT_FOUND (404)', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        } as Response);
      }

      if (target.includes('/agents') && !target.includes('/run')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'coding_agent' }] }),
        } as Response);
      }

      if (target.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        } as Response);
      }

      if (target.includes('/agents/coding_agent/run')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'not_found' }),
        } as unknown as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const input = await screen.findByTestId('agent-input');
    await user.type(input, 'Question');

    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await screen.findByTestId('agents-run-error');
    expect(screen.getByTestId('agents-run-error')).toHaveTextContent(
      'Failed to run agent instruction (404)',
    );
  });
});
