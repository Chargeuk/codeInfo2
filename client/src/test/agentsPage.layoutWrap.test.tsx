import { jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
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
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
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
      return mockJsonResponse({ items: baseConversations, nextCursor: 'next' });
    }

    if (target.includes('/conversations/')) {
      return mockJsonResponse({ items: [] });
    }

    return mockJsonResponse({});
  });
}

describe('Agents page layout wrap', () => {
  it('keeps the list panel scrollable and keeps Load more inside it', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const panel = await screen.findByTestId('conversation-list');
    const row = await screen.findByTestId('conversation-row');
    const list = row.closest('ul');
    const scrollContainer = list?.parentElement;

    expect(scrollContainer).not.toBeNull();
    expect(getComputedStyle(scrollContainer!).overflowY).toBe('auto');
    expect(
      within(panel).getByTestId('conversation-load-more'),
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
  });

  it('renders the command selector and execute button in the same row', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const commandRow = await screen.findByTestId('agent-command-row');
    expect(
      within(commandRow).getByTestId('agent-command-select'),
    ).toBeInTheDocument();
    expect(
      within(commandRow).getByTestId('agent-command-execute'),
    ).toBeInTheDocument();
  });

  it('renders the instruction input and action buttons in the same row', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const instructionRow = await screen.findByTestId('agent-instruction-row');
    expect(
      within(instructionRow).getByTestId('agent-input'),
    ).toBeInTheDocument();
    expect(
      within(instructionRow).getByTestId('agent-send'),
    ).toBeInTheDocument();
  });

  it('moves the stop button out of the header row', async () => {
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const headerRow = await screen.findByTestId('agent-header-row');
    expect(within(headerRow).queryByTestId('agent-stop')).toBeNull();

    const instructionRow = await screen.findByTestId('agent-instruction-row');
    expect(
      within(instructionRow).getByTestId('agent-stop'),
    ).toBeInTheDocument();
  });
});
