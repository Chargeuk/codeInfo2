import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memo } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn<typeof fetch>();
const transcriptRenderSpy = jest.fn();

await jest.unstable_mockModule(
  '../components/agents/AgentsTranscriptPane',
  async () => ({
    __esModule: true,
    default: memo(function MockAgentsTranscriptPane(props: unknown) {
      transcriptRenderSpy(props);
      return <div data-testid="mock-agents-transcript-pane" />;
    }),
  }),
);

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  transcriptRenderSpy.mockReset();
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

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function mockAgentsFetch() {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }

    if (target.includes('/agents') && !target.includes('/commands')) {
      return mockJsonResponse({ agents: [{ name: 'coding_agent' }] });
    }

    if (target.includes('/agents/coding_agent/commands')) {
      return mockJsonResponse({ commands: [] });
    }

    if (target.includes('/conversations') && target.includes('agentName=')) {
      return mockJsonResponse({ items: [], nextCursor: null });
    }

    if (target.includes('/conversations/')) {
      return mockJsonResponse({ items: [] });
    }

    return mockJsonResponse({});
  });
}

describe('Agents page input isolation', () => {
  it('does not rerender the transcript pane while typing when transcript data is unchanged', async () => {
    mockAgentsFetch();
    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });

    render(<RouterProvider router={router} />);

    await screen.findByTestId('mock-agents-transcript-pane');
    await screen.findByTestId('agent-input');

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const renderCountBeforeTyping = transcriptRenderSpy.mock.calls.length;
    const input = screen.getByTestId('agent-input');
    await user.type(input, 'Isolated typing');

    expect(input).toHaveValue('Isolated typing');
    expect(transcriptRenderSpy).toHaveBeenCalledTimes(renderCountBeforeTyping);
  });
});
