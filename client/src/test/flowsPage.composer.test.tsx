import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
const mockFetch = jest.fn<typeof fetch>();
const desktopWidth = 1280;
beforeAll(() => {
  global.fetch = mockFetch;
});
beforeEach(() => {
  setScopedTestEnvValue('MODE', 'test');
  mockFetch.mockReset();
  (
    globalThis as unknown as {
      __wsMock?: {
        reset: () => void;
      };
    }
  ).__wsMock?.reset();
  setViewportWidth(desktopWidth);
});
afterEach(() => {
  setViewportWidth(desktopWidth);
});
const { default: App } = await import('../App');
const { default: FlowsPage } = await import('../pages/FlowsPage');
const { default: HomePage } = await import('../pages/HomePage');
const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'flows', element: <FlowsPage /> },
    ],
  },
];
function setViewportWidth(width: number) {
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}
function mockJsonResponse(
  payload: unknown,
  init?: {
    status?: number;
  },
) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}
function installFlowsComposerMocks() {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target =
      typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.toString()
          : 'url' in url && typeof url.url === 'string'
            ? url.url
            : url.toString();
    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }
    if (target.includes('/flows/daily?') || target.endsWith('/flows/daily')) {
      return mockJsonResponse({
        flow: {
          name: 'daily',
          description: 'Daily flow',
          sourceLabel: 'Repo Alpha',
          sourceId: 'repo-alpha',
          disabled: false,
          warnings: [],
        },
      });
    }
    if (target.includes('/flows') && !target.includes('/run')) {
      return mockJsonResponse({
        flows: [
          {
            name: 'daily',
            description: 'Daily flow',
            sourceLabel: 'Repo Alpha',
            sourceId: 'repo-alpha',
            disabled: false,
          },
        ],
      });
    }
    if (target.includes('/conversations/') && target.includes('/turns')) {
      return mockJsonResponse({ items: [], nextCursor: null });
    }
    if (target.includes('/conversations')) {
      return mockJsonResponse({ items: [], nextCursor: null });
    }
    return mockJsonResponse({});
  });
}
function makeFlowConversation(overrides?: {
  title?: string;
  flowName?: string;
  stepPath?: number[];
}) {
  return {
    conversationId: 'flow-conversation-1',
    title: overrides?.title ?? 'MT19 Copy Proof mt19-1779370180455',
    provider: 'codex',
    model: 'gpt-5.4',
    source: 'REST',
    lastMessageAt: '2026-05-21T13:29:00.000Z',
    archived: false,
    flags: {
      flowName: overrides?.flowName ?? 'daily',
      flow: overrides?.stepPath ? { stepPath: overrides.stepPath } : {},
    },
  };
}
describe('Flows page composer parity', () => {
  it('keeps the footer trigger order and compact working path/title states on the shared composer shell', async () => {
    const user = userEvent.setup();
    installFlowsComposerMocks();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const composer = await screen.findByTestId('chat-controls');
    const infoButton = await screen.findByTestId('flow-info');
    const newButton = await screen.findByTestId(
      'flow-new-conversation-trigger',
    );
    const workingPathButton = await screen.findByTestId(
      'flow-working-folder-trigger',
    );
    const flowButton = await screen.findByTestId('flow-select-trigger');
    const titleButton = await screen.findByTestId('flow-title-trigger');
    const launchTitle = await screen.findByTestId('flow-launch-title');
    expect(composer).toContainElement(infoButton);
    expect(composer).toContainElement(newButton);
    expect(composer).toContainElement(workingPathButton);
    expect(composer).toContainElement(flowButton);
    expect(composer).toContainElement(titleButton);
    expect(
      infoButton.compareDocumentPosition(newButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      newButton.compareDocumentPosition(workingPathButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      workingPathButton.compareDocumentPosition(flowButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      flowButton.compareDocumentPosition(titleButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => expect(flowButton).toHaveTextContent('daily'));
    expect(titleButton).toBeEnabled();
    expect(titleButton).toHaveTextContent('daily');
    expect(launchTitle).toHaveTextContent('daily');
    expect(screen.queryByText('Selected flow')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Resume step:/)).not.toBeInTheDocument();
    expect(newButton).toBeVisible();
    expect(screen.queryByTestId('flow-note')).not.toBeInTheDocument();
    await user.click(workingPathButton);
    const workingPathDialog = await screen.findByRole('dialog', {
      name: /choose folder…/i,
    });
    expect(workingPathDialog).toBeInTheDocument();
    await user.click(
      within(workingPathDialog).getByRole('button', { name: 'Close' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /choose folder…/i }),
      ).not.toBeInTheDocument(),
    );
    await user.click(titleButton);
    const titlePopover = await screen.findByTestId('flow-title-popover');
    const titleInput = within(titlePopover).getByTestId('flow-title-input');
    expect(titleInput).toHaveValue('daily');
    await user.clear(titleInput);
    await user.type(titleInput, 'Daily recap');
    await user.tab();
    expect(titleButton).toBeEnabled();
    expect(titleButton).toHaveTextContent('Daily recap');
  });
  it('copies the active title instead of reopening the editor once a flow conversation already exists', async () => {
    const user = userEvent.setup();
    installFlowsComposerMocks();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : 'url' in url && typeof url.url === 'string'
              ? url.url
              : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      if (target.includes('/flows/daily?') || target.endsWith('/flows/daily')) {
        return mockJsonResponse({
          flow: {
            name: 'daily',
            description: 'Daily flow',
            sourceLabel: 'Repo Alpha',
            sourceId: 'repo-alpha',
            disabled: false,
            warnings: [],
          },
        });
      }
      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'daily',
              description: 'Daily flow',
              sourceLabel: 'Repo Alpha',
              sourceId: 'repo-alpha',
              disabled: false,
            },
          ],
        });
      }
      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [], nextCursor: null });
      }
      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            makeFlowConversation({
              title: 'Resume nightly sync',
              stepPath: [0],
            }),
          ],
          nextCursor: null,
        });
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const titleButton = await screen.findByTestId('flow-title-trigger');
    await waitFor(() =>
      expect(titleButton).toHaveTextContent('Resume nightly sync'),
    );
    expect(titleButton).toBeEnabled();
    expect(titleButton).toHaveAccessibleName('Copy flow title');
    await user.click(titleButton);
    await waitFor(() =>
      expect(
        screen.queryByTestId('flow-title-popover'),
      ).not.toBeInTheDocument(),
    );
  });
  it('shows the repository source under each flow option in the selector', async () => {
    const user = userEvent.setup();
    installFlowsComposerMocks();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await user.click(await screen.findByTestId('flow-select-trigger'));
    const selector = await screen.findByTestId('flow-selector-content');
    expect(within(selector).getByText('daily')).toBeInTheDocument();
    expect(within(selector).getByText('Repo Alpha')).toBeInTheDocument();
  });
  it('shows the shared conversation-header new action on Flows', async () => {
    installFlowsComposerMocks();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const newButton = await screen.findByTestId('conversation-new');
    expect(newButton).toBeVisible();
    expect(newButton).toHaveAccessibleName('New flow');
  });
});
