import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { createLogger } from '../logging/logger';

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

const routes = [
  {
    path: '/',
    element: <App />,
    children: [{ path: 'agents', element: <AgentsPage /> }],
  },
];

const baseConversations = [
  {
    conversationId: 'c1',
    title: 'Active conversation',
    provider: 'codex',
    model: 'gpt-5.2',
    lastMessageAt: '2025-01-02T00:00:00.000Z',
    archived: false,
    agentName: 'a1',
  },
  {
    conversationId: 'c2',
    title: 'Archived conversation',
    provider: 'codex',
    model: 'gpt-5.2',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: true,
    agentName: 'a1',
  },
];

const logSidebarParityRendered = (params: {
  variant: 'chat' | 'agents';
  filtersVisible: boolean;
  bulkEnabled: boolean;
}) => {
  const log = createLogger('client-test', () => '/test');
  log('info', '0000023 sidebar parity tests rendered', params);
};

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
}

function mockAgentsFetch(params?: {
  mongoConnected?: boolean;
  conversations?: typeof baseConversations;
}) {
  const mongoConnected = params?.mongoConnected ?? true;
  const conversations = params?.conversations ?? baseConversations;

  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected });
    }

    if (target.includes('/agents') && !target.includes('/commands')) {
      return mockJsonResponse({ agents: [{ name: 'a1' }] });
    }

    if (target.includes('/agents/a1/commands')) {
      return mockJsonResponse({ commands: [] });
    }

    if (target.includes('/conversations/bulk/')) {
      if (target.includes('/delete')) {
        return mockJsonResponse({ status: 'ok', deletedCount: 1 });
      }
      return mockJsonResponse({ status: 'ok', updatedCount: 1 });
    }

    if (target.includes('/conversations/') && target.includes('/archive')) {
      return mockJsonResponse({ status: 'ok' });
    }

    if (target.includes('/conversations/') && target.includes('/restore')) {
      return mockJsonResponse({ status: 'ok' });
    }

    if (target.includes('/conversations') && target.includes('agentName=')) {
      return mockJsonResponse({ items: conversations, nextCursor: null });
    }

    if (target.includes('/conversations/')) {
      return mockJsonResponse({ items: [] });
    }

    return mockJsonResponse({});
  });
}

describe('AgentsPage sidebar actions', () => {
  it('renders filter tabs and toggles selection', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();
    logSidebarParityRendered({
      variant: 'agents',
      filtersVisible: true,
      bulkEnabled: true,
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-page');

    const activeButton = screen.getByTestId('conversation-filter-active');
    expect(activeButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-filter-archived'),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('enables bulk archive/restore based on selection', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Active conversation');

    await user.click(screen.getAllByTestId('conversation-select')[0]);
    expect(screen.getByTestId('conversation-bulk-archive')).toBeEnabled();
    expect(screen.getByTestId('conversation-bulk-restore')).toBeDisabled();

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await user.click(screen.getAllByTestId('conversation-select')[0]);
    expect(screen.getByTestId('conversation-bulk-restore')).toBeEnabled();
  });

  it('shows bulk delete only for archived filter', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Active conversation');

    expect(screen.queryByTestId('conversation-bulk-delete')).toBeNull();

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-bulk-delete'),
      ).toBeInTheDocument(),
    );
  });

  it('renders archive and restore row actions for active and archived rows', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Active conversation');

    expect(screen.getByTestId('conversation-archive')).toBeInTheDocument();

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await screen.findByText('Archived conversation');
    expect(screen.getByTestId('conversation-restore')).toBeInTheDocument();
  });

  it('disables controls when persistence is unavailable', async () => {
    mockAgentsFetch({ mongoConnected: false });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-page');

    expect(screen.getByTestId('conversation-filter-active')).toBeDisabled();
    expect(screen.getByTestId('conversation-refresh')).toBeDisabled();
  });
});
