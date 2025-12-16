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

describe('Agents page - agent change', () => {
  it('aborts an in-flight run and resets to new conversation state', async () => {
    let abortTriggered = false;
    const runBodies: Record<string, unknown>[] = [];

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
            json: async () => ({
              agents: [{ name: 'a1' }, { name: 'a2' }],
            }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/a1/run')) {
          const signal = init?.signal as AbortSignal | undefined;
          return new Promise((_resolve, reject) => {
            const rejectAbort = () => {
              abortTriggered = true;
              const err = new Error('aborted');
              (err as Error & { name: string }).name = 'AbortError';
              reject(err);
            };
            if (signal?.aborted) {
              rejectAbort();
              return;
            }
            signal?.addEventListener('abort', rejectAbort, { once: true });
          });
        }

        if (target.includes('/agents/a2/run')) {
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              agentName: 'a2',
              conversationId: 'new-convo',
              modelId: 'gpt-5.1-codex-max',
              segments: [{ type: 'answer', text: 'ok' }],
            }),
          } as Response);
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

    const workingFolder = await screen.findByRole('textbox', {
      name: 'working_folder',
    });
    const input = await screen.findByTestId('agent-input');
    const send = await screen.findByTestId('agent-send');
    const stop = await screen.findByTestId('agent-stop');

    await userEvent.type(workingFolder, '/abs/path');
    await userEvent.type(input, 'Do work');
    await act(async () => {
      await userEvent.click(send);
    });

    await waitFor(() => expect(stop).toBeEnabled());
    expect(screen.getByText('Do work')).toBeInTheDocument();

    const agentSelect = screen.getByRole('combobox', { name: /agent/i });
    await userEvent.click(agentSelect);
    const option = await screen.findByRole('option', { name: 'a2' });
    await act(async () => {
      await userEvent.click(option);
    });

    await waitFor(() => expect(abortTriggered).toBe(true));
    await waitFor(() => expect(screen.queryByText('Do work')).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'working_folder' }),
      ).toHaveValue(''),
    );

    const inputAfter = await screen.findByTestId('agent-input');
    await userEvent.type(inputAfter, 'Second');
    await act(async () => {
      await userEvent.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() => expect(runBodies.length).toBeGreaterThan(0));
    expect(runBodies[0]).not.toHaveProperty('conversationId');
  });
});
