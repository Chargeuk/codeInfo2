import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
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

const baseConversations = [
  {
    conversationId: 'a1',
    title: 'Agents conversation',
    provider: 'codex',
    model: 'gpt-5.2',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: false,
    agentName: 'coding_agent',
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

function mockAgentsFetch(options?: {
  conversations?: unknown[];
  turns?: unknown[];
}) {
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
      return mockJsonResponse({
        items: options?.conversations ?? baseConversations,
        nextCursor: 'next',
      });
    }

    if (target.includes('/conversations/')) {
      return mockJsonResponse({ items: options?.turns ?? [] });
    }

    return mockJsonResponse({});
  });
}

describe('Agents shared shell layout wrap', () => {
  it('keeps the list panel scrollable and keeps Load more inside it', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const panels = await screen.findAllByTestId('conversation-list');
    const panel = panels.find((candidate) =>
      within(candidate).queryByTestId('conversation-load-more'),
    );
    const row = await screen.findByTestId('conversation-row');
    const list = row.closest('ul');
    const scrollContainer = list?.parentElement;

    expect(panel).toBeDefined();
    expect(scrollContainer).not.toBeNull();
    expect(getComputedStyle(scrollContainer!).overflowY).toBe('auto');
    expect(
      within(panel!).getByTestId('conversation-load-more'),
    ).toBeInTheDocument();
  });

  it('keeps the transcript container flex stretch styles', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const transcript = await screen.findByTestId('chat-transcript');
    expect(transcript.style.flex).toBe('1 1 0%');
    expect(['0', '0px']).toContain(transcript.style.minHeight);
    expect(transcript.style.overflowY).toBe('auto');
    expect(transcript.parentElement).not.toBeNull();
    const transcriptOverlay = transcript.parentElement!;
    const overlayStyles = getComputedStyle(transcriptOverlay);
    expect(overlayStyles.overflow).toBe('hidden');
    expect(overlayStyles.position).toBe('relative');
    expect(overlayStyles.display).toBe('flex');
  });

  it('renders the command selector before the step control in the shared footer order', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const commandTrigger = await screen.findByTestId('agent-command-trigger');
    const stepTrigger = await screen.findByTestId('agent-step-trigger');

    expect(
      commandTrigger.compareDocumentPosition(stepTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the instruction input and action buttons in the same row', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('agent-input')).toBeInTheDocument();
    expect(await screen.findByTestId('agent-send')).toBeInTheDocument();
  });

  it('renders only the shared send control while no run is active', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('agent-send')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-stop')).toBeNull();
  });

  it('keeps the shared footer trigger order intact', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const footerButtons = [
      await screen.findByTestId('agent-info'),
      await screen.findByTestId('agent-new-conversation-trigger'),
      await screen.findByTestId('agent-working-path-trigger'),
      await screen.findByTestId('agent-select-trigger'),
      await screen.findByTestId('agent-command-trigger'),
      await screen.findByTestId('agent-step-trigger'),
    ];

    footerButtons.reduce((previous, current) => {
      expect(
        previous.compareDocumentPosition(current) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      return current;
    });
  });

  it('shows the shared conversation-header new action on Agents', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const newButton = await screen.findByTestId('conversation-new');
    expect(newButton).toBeVisible();
    expect(newButton).toHaveAccessibleName('New conversation');
  });

  it('renders a single primary action button', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('agent-send')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-stop')).toBeNull();
  });

  it('applies the shared small-input and outlined-trigger styles to agent controls', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const instructionInput = await screen.findByTestId('agent-input');
    const instructionRoot = instructionInput.closest('.MuiInputBase-root');
    expect(instructionRoot).toHaveClass('MuiInputBase-sizeSmall');

    expect(await screen.findByTestId('agent-working-path-trigger')).toHaveClass(
      'MuiButton-outlined',
    );
    expect(await screen.findByTestId('agent-select-trigger')).toHaveClass(
      'MuiButton-outlined',
    );
    expect(await screen.findByTestId('agent-command-trigger')).toHaveClass(
      'MuiButton-outlined',
    );
    expect(await screen.findByTestId('agent-step-trigger')).toHaveClass(
      'MuiIconButton-root',
    );

    const sendButton = await screen.findByTestId('agent-send');
    expect(sendButton).toHaveClass('MuiIconButton-root');
  });

  it('uses the shared pinned-bottom and scroll-away rules on Agents', async () => {
    const measurementHarness = installTranscriptMeasurementHarness();
    mockAgentsFetch({
      conversations: [
        {
          conversationId: 'a-scroll',
          title: 'Agents scroll conversation',
          provider: 'codex',
          model: 'gpt-5.2',
          lastMessageAt: '2026-03-19T00:00:00.000Z',
          archived: false,
          agentName: 'coding_agent',
        },
      ],
      turns: Array.from({ length: 14 }, (_, index) => ({
        turnId: `turn-${index + 1}`,
        conversationId: 'a-scroll',
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `Agent message ${index + 1}`,
        provider: 'codex',
        model: 'gpt-5.2',
        status: 'ok',
        createdAt: `2026-03-19T00:0${index}:00.000Z`,
      })),
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const conversationRow = await screen.findByTestId('conversation-row');
    fireEvent.click(conversationRow);
    const transcript = await screen.findByTestId('chat-transcript');
    await waitFor(() =>
      expect(screen.getAllByTestId('chat-bubble')).toHaveLength(14),
    );
    const firstMessage = within(transcript).getByText('Agent message 1');
    const secondMessage = within(transcript).getByText('Agent message 2');
    expect(
      firstMessage.compareDocumentPosition(secondMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    measurementHarness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1200,
      scrollTop: 880,
    });

    transcript.scrollTop = 430;
    fireEvent.wheel(transcript, { deltaY: -320 });
    fireEvent.scroll(transcript);
    await waitFor(() => expect(transcript.scrollTop).toBe(430));

    measurementHarness.setScrollMetrics(transcript, {
      scrollHeight: 1320,
      scrollTop: 430,
    });
    measurementHarness.triggerResize(transcript);
    expect(transcript.scrollTop).toBe(430);

    transcript.scrollTop = 960;
    fireEvent.scroll(transcript);

    measurementHarness.setScrollMetrics(transcript, {
      scrollHeight: 1410,
      scrollTop: 960,
    });
    measurementHarness.triggerResize(transcript);
    expect(transcript.scrollTop).toBe(1090);

    measurementHarness.restore();
  });
});
