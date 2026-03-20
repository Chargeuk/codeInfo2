import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import SharedTranscript from '../components/chat/SharedTranscript';
import useSharedTranscriptState from '../components/chat/useSharedTranscriptState';
import { installTranscriptMeasurementHarness } from './support/transcriptMeasurementHarness';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
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

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

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

describe('Agents reasoning rendering (assistantThink / analysis_delta)', () => {
  it('preserves thought-process expansion across virtual unmount and remount', async () => {
    const harness = installTranscriptMeasurementHarness();
    const user = userEvent.setup();
    const messages = Array.from({ length: 18 }, (_, index) => ({
      id: `assistant-${index + 1}`,
      role: 'assistant' as const,
      content: `Agent assistant message ${index + 1}`,
      think:
        index === 2 ? 'Agents virtualized reasoning survives remount.' : '',
      createdAt: `2026-03-19T01:${String(index).padStart(2, '0')}:00.000Z`,
    }));

    function StatefulAgentsTranscript() {
      const sharedState = useSharedTranscriptState({
        surface: 'agents',
        conversationId: 'agents-remount',
      });

      return (
        <SharedTranscript
          surface="agents"
          conversationId="agents-remount"
          messages={messages}
          activeToolsAvailable={false}
          emptyMessage="Empty"
          citationsOpen={sharedState.citationsOpen}
          thinkOpen={sharedState.thinkOpen}
          toolOpen={sharedState.toolOpen}
          toolErrorOpen={sharedState.toolErrorOpen}
          onToggleCitation={sharedState.toggleCitation}
          onToggleThink={sharedState.toggleThink}
          onToggleTool={sharedState.toggleTool}
          onToggleToolError={sharedState.toggleToolError}
        />
      );
    }

    render(<StatefulAgentsTranscript />);

    const transcript = await screen.findByTestId('chat-transcript');
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 4320,
      scrollTop: 0,
    });

    const initialToggle = await screen.findByTestId('think-toggle');
    await user.click(initialToggle);
    await waitFor(() =>
      expect(initialToggle).toHaveAttribute('aria-expanded', 'true'),
    );
    expect(await screen.findByTestId('think-content')).toHaveTextContent(
      'Agents virtualized reasoning survives remount.',
    );

    transcript.scrollTop = 3200;
    fireEvent.scroll(transcript);
    await waitFor(() =>
      expect(screen.queryByTestId('think-content')).not.toBeInTheDocument(),
    );

    transcript.scrollTop = 0;
    fireEvent.scroll(transcript);
    const toggle = await screen.findByTestId('think-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('think-content')).toHaveTextContent(
      'Agents virtualized reasoning survives remount.',
    );

    harness.restore();
  });

  it('keeps thought process collapsed by default and toggles open', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({ commands: [] });
      }

      if (
        target.includes('/conversations') &&
        target.includes('agentName=a1')
      ) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'c1',
              title: 'Agent conversation',
              provider: 'codex',
              model: 'gpt-5.2',
              lastMessageAt: '2025-01-01T00:00:00.000Z',
              archived: false,
            },
          ],
          nextCursor: null,
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Agent conversation');
    await user.click(screen.getByText('Agent conversation'));

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'inflight_snapshot',
      conversationId: 'c1',
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: 'Answer',
        assistantThink: 'Thinking...\nSecond line',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
      },
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId: 'c1',
      seq: 2,
      inflightId: 'i1',
      status: 'ok',
    });

    const toggle = await screen.findByTestId('think-toggle');
    expect(screen.queryByTestId('think-content')).toBeNull();

    await user.click(toggle);
    const thinkContent = await screen.findByTestId('think-content');
    await waitFor(() => expect(thinkContent).toBeVisible());
    expect(thinkContent.textContent ?? '').toContain('Thinking');
  });

  it('resets thought-process expansion when the active conversation changes', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({ commands: [] });
      }

      if (
        target.includes('/conversations') &&
        target.includes('agentName=a1')
      ) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'c1',
              title: 'Conversation 1',
              provider: 'codex',
              model: 'gpt-5.2',
              lastMessageAt: '2025-01-01T00:00:00.000Z',
              archived: false,
            },
            {
              conversationId: 'c2',
              title: 'Conversation 2',
              provider: 'codex',
              model: 'gpt-5.2',
              lastMessageAt: '2025-01-01T00:01:00.000Z',
              archived: false,
            },
          ],
          nextCursor: null,
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Conversation 1');
    await user.click(screen.getByText('Conversation 1'));

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'inflight_snapshot',
      conversationId: 'c1',
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: 'Answer One',
        assistantThink: 'Reasoning One',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
      },
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId: 'c1',
      seq: 2,
      inflightId: 'i1',
      status: 'ok',
    });

    await user.click(await screen.findByTestId('think-toggle'));
    expect(await screen.findByTestId('think-content')).toBeVisible();

    await user.click(await screen.findByText('Conversation 2'));

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'inflight_snapshot',
      conversationId: 'c2',
      seq: 3,
      inflight: {
        inflightId: 'i2',
        assistantText: 'Answer Two',
        assistantThink: 'Reasoning Two',
        toolEvents: [],
        startedAt: '2025-01-01T00:01:00.000Z',
      },
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId: 'c2',
      seq: 4,
      inflightId: 'i2',
      status: 'ok',
    });

    const secondToggle = await screen.findByTestId('think-toggle');
    expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('think-content')).toBeNull();
    expect(await screen.findByText('Answer Two')).toBeInTheDocument();
  });
});
