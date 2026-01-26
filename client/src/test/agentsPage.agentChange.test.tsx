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

const buildProvidersResponse = (codexAvailable = true) => ({
  providers: [
    {
      id: 'lmstudio',
      label: 'LM Studio',
      available: true,
      toolsAvailable: true,
    },
    {
      id: 'codex',
      label: 'OpenAI Codex',
      available: codexAvailable,
      toolsAvailable: codexAvailable,
      reason: codexAvailable ? undefined : 'missing auth',
    },
  ],
});

const modelsResponse = {
  models: [
    {
      key: 'mock-model',
      displayName: 'Mock Model',
      type: 'gguf',
    },
  ],
  available: true,
  toolsAvailable: true,
};

function emitWsEvent(event: Record<string, unknown>) {
  const wsRegistry = (
    globalThis as unknown as {
      __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
    }
  ).__wsMock;
  const ws = wsRegistry?.last();
  if (!ws) throw new Error('No WebSocket instance; did AgentsPage mount?');
  act(() => {
    ws._receive(event);
  });
}

describe('Agents page - agent change', () => {
  it('resets to new conversation state on agent change (without aborting server runs)', async () => {
    const runBodies: Record<string, unknown>[] = [];
    let a1ConversationId: string | null = null;

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

        if (target.includes('/chat/providers')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => buildProvidersResponse(true),
          } as Response);
        }

        if (target.includes('/chat/models')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => modelsResponse,
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
            json: async () => ({
              agents: [{ name: 'a1' }, { name: 'a2' }],
            }),
          } as Response);
        }

        if (target.includes('/agents/') && target.includes('/commands')) {
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

        if (target.includes('/logs')) {
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({ status: 'accepted' }),
          } as Response);
        }

        if (target.includes('/agents/a1/run')) {
          if (init?.body) {
            const parsed = JSON.parse(init.body.toString()) as Record<
              string,
              unknown
            >;
            a1ConversationId =
              typeof parsed.conversationId === 'string'
                ? parsed.conversationId
                : null;
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'a1',
              conversationId: a1ConversationId ?? 'c1',
              inflightId: 'i1',
              modelId: 'gpt-5.1-codex-max',
            }),
          } as Response);
        }

        if (target.includes('/agents/a2/run')) {
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'a2',
              conversationId: 'new-convo',
              inflightId: 'i2',
              modelId: 'gpt-5.1-codex-max',
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

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const workingFolder = await screen.findByRole('textbox', {
      name: 'working_folder',
    });
    const input = await screen.findByTestId('agent-input');
    const send = await screen.findByTestId('agent-send');

    await userEvent.type(workingFolder, '/abs/path');
    await userEvent.type(input, 'Do work');
    await act(async () => {
      await userEvent.click(send);
    });

    await waitFor(() => expect(a1ConversationId).toBeTruthy());
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'user_turn',
      conversationId: a1ConversationId,
      seq: 1,
      inflightId: 'i1',
      content: 'Do work',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    const stop = await screen.findByTestId('agent-stop');
    await waitFor(() => expect(stop).toBeEnabled());
    expect(stop).toHaveClass(
      'MuiButton-contained',
      'MuiButton-containedError',
      'MuiButton-sizeSmall',
    );
    expect(screen.getByText('Do work')).toBeInTheDocument();

    const agentSelect = screen.getByRole('combobox', { name: /agent/i });
    await userEvent.click(agentSelect);
    const option = await screen.findByRole('option', { name: 'a2' });
    await act(async () => {
      await userEvent.click(option);
    });

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
    expect(runBodies[0]).toHaveProperty('conversationId');
    expect(runBodies[0].conversationId).toEqual(expect.any(String));
    expect((runBodies[0].conversationId as string).length).toBeGreaterThan(0);
  });
});

describe('Agents page - device auth', () => {
  const setup = (codexAvailable = true) => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        } as Response);
      }

      if (target.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => buildProvidersResponse(codexAvailable),
        } as Response);
      }

      if (target.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => modelsResponse,
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
          json: async () => ({
            agents: [{ name: 'a1' }, { name: 'a2' }],
          }),
        } as Response);
      }

      if (target.includes('/agents/') && target.includes('/commands')) {
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

      if (target.includes('/logs')) {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({ status: 'accepted' }),
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
  };

  it('shows device-auth button when an agent is selected and Codex is available', async () => {
    setup(true);

    const agentSelect = await screen.findByRole('combobox', {
      name: /agent/i,
    });
    expect(
      screen.queryByRole('button', {
        name: 'Re-authenticate (device auth)',
      }),
    ).toBeNull();

    await userEvent.click(agentSelect);
    const option = await screen.findByRole('option', { name: 'a1' });
    await act(async () => {
      await userEvent.click(option);
    });

    expect(
      await screen.findByRole('button', {
        name: 'Re-authenticate (device auth)',
      }),
    ).toBeInTheDocument();
  });

  it('defaults the device-auth dialog target to the selected agent', async () => {
    setup(true);

    const agentSelect = await screen.findByRole('combobox', {
      name: /agent/i,
    });
    await userEvent.click(agentSelect);
    const option = await screen.findByRole('option', { name: 'a2' });
    await act(async () => {
      await userEvent.click(option);
    });

    const button = await screen.findByRole('button', {
      name: 'Re-authenticate (device auth)',
    });
    await act(async () => {
      await userEvent.click(button);
    });

    const targetSelect = await screen.findByRole('combobox', {
      name: 'Target',
    });
    expect(targetSelect).toHaveTextContent('Agent: a2');
  });

  it('hides the device-auth button when Codex is unavailable', async () => {
    setup(false);

    const agentSelect = await screen.findByRole('combobox', {
      name: /agent/i,
    });
    await userEvent.click(agentSelect);
    const option = await screen.findByRole('option', { name: 'a1' });
    await act(async () => {
      await userEvent.click(option);
    });

    expect(
      screen.queryByRole('button', {
        name: 'Re-authenticate (device auth)',
      }),
    ).toBeNull();
  });
});
