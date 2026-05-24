import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn<typeof fetch>();
const desktopWidth = 1280;

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
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

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
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
          disabled: false,
          warnings: [],
        },
      });
    }

    if (target.includes('/flows') && !target.includes('/run')) {
      return mockJsonResponse({
        flows: [{ name: 'daily', description: 'Daily flow', disabled: false }],
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

describe('Flows page composer parity', () => {
  it('keeps the footer trigger order and compact working path/title states on the shared composer shell', async () => {
    const user = userEvent.setup();

    installFlowsComposerMocks();

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const composer = await screen.findByTestId('chat-controls');
    const infoButton = await screen.findByTestId('flow-info');
    const workingPathButton = await screen.findByTestId(
      'flow-working-folder-trigger',
    );
    const flowButton = await screen.findByTestId('flow-select-trigger');
    const titleButton = await screen.findByTestId('flow-title-trigger');

    expect(composer).toContainElement(infoButton);
    expect(composer).toContainElement(workingPathButton);
    expect(composer).toContainElement(flowButton);
    expect(composer).toContainElement(titleButton);
    expect(
      infoButton.compareDocumentPosition(workingPathButton) &
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
    expect(titleButton).toHaveTextContent('Set title');

    await user.click(workingPathButton);
    const workingPathPopover = await screen.findByTestId(
      'flow-working-folder-popover',
    );
    const workingFolderInput = within(workingPathPopover).getByTestId(
      'flow-working-folder-input',
    );
    await user.clear(workingFolderInput);
    await user.type(workingFolderInput, '/Users/daniel/repos/codeinfo2');

    expect(workingPathButton).toHaveTextContent('codeinfo2');
    expect(workingPathButton).not.toHaveTextContent(
      '/Users/daniel/repos/codeinfo2',
    );

    await user.click(
      within(workingPathPopover).getByRole('button', { name: 'Close' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('flow-working-folder-popover'),
      ).not.toBeInTheDocument(),
    );

    await user.click(titleButton);
    const titlePopover = await screen.findByTestId('flow-title-popover');
    const titleInput = within(titlePopover).getByTestId('flow-title-input');
    await user.clear(titleInput);
    await user.type(titleInput, 'Daily recap');
    await user.tab();

    expect(titleButton).toBeEnabled();
    expect(titleButton).toHaveTextContent('Daily recap');
  });
});
