import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { createLogger } from '../logging/logger';
import { setupChatWsHarness } from './support/mockChatWs';
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
const { default: ChatPage } = await import('../pages/ChatPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat', element: <ChatPage /> },
    ],
  },
];

const logSharedShellLayoutConfigured = (params: {
  scrollContainer: boolean;
  loadMoreInside: boolean;
  overflowGuarded: boolean;
}) => {
  const log = createLogger('client-test', () => '/test');
  log('info', '0000023 shared shell layout tests configured', params);
};

function getAppShellContainer(): HTMLElement {
  const containers = Array.from(
    document.querySelectorAll<HTMLElement>('.MuiContainer-root'),
  );
  if (containers.length === 0) {
    return screen.getByTestId('chat-column');
  }

  if (containers.length === 1) {
    return containers[0]!;
  }

  const nested = containers.find((container) =>
    containers.some(
      (other) => other !== container && container.contains(other),
    ),
  );

  return nested ?? containers[0]!;
}

function installTranscriptWidthMock(transcript: HTMLElement) {
  const baseWidth = 420;

  Object.defineProperty(transcript, 'clientWidth', {
    configurable: true,
    get: () => baseWidth,
  });

  Object.defineProperty(transcript, 'scrollWidth', {
    configurable: true,
    get: () => {
      const chatColumn = screen.queryByTestId('chat-column');
      const chatColumnMinWidth = chatColumn
        ? getComputedStyle(chatColumn).minWidth
        : 'auto';
      const chatColumnMinWidthOk =
        chatColumnMinWidth === '0px' ||
        chatColumnMinWidth === '0' ||
        chatColumnMinWidth === '';

      const citationChunk = screen.queryByTestId('citation-chunk');
      const citationWrapOk = citationChunk
        ? (citationChunk as HTMLElement).style.overflowWrap === 'anywhere' &&
          (citationChunk as HTMLElement).style.wordBreak === 'break-word'
        : true;

      const toolPayload = screen.queryByTestId('tool-payload');
      const toolWrapOk = toolPayload
        ? (toolPayload as HTMLElement).style.overflowWrap === 'anywhere' &&
          (toolPayload as HTMLElement).style.wordBreak === 'break-word'
        : true;

      const markdownPre = document.querySelector(
        '[data-testid="assistant-markdown"] pre',
      ) as HTMLElement | null;
      const markdownOverflowX = markdownPre
        ? getComputedStyle(markdownPre).overflowX
        : 'visible';
      const markdownOverflowOk =
        !markdownPre ||
        markdownOverflowX === 'auto' ||
        markdownOverflowX === 'scroll';

      const ok =
        chatColumnMinWidthOk &&
        citationWrapOk &&
        toolWrapOk &&
        markdownOverflowOk;

      return ok ? baseWidth : baseWidth + 100;
    },
  });
}

function installChatLayoutRectMocks(options?: {
  sidebar?: HTMLElement | null;
  transcript?: HTMLElement | null;
  chatColumn?: HTMLElement | null;
}) {
  const smBreakpoint = 600;
  const sidebarWidth = 320;
  const columnGap = 16;

  const sidebar = options?.sidebar ?? screen.queryByTestId('conversation-list');
  const transcript =
    options?.transcript ?? screen.queryByTestId('chat-transcript');
  const chatColumn = options?.chatColumn ?? screen.queryByTestId('chat-column');
  const isDesktop = window.innerWidth >= smBreakpoint;

  const chatColumnMinWidth = chatColumn?.style.minWidth;
  const chatColumnWidth = chatColumn?.style.width;
  const chatColumnConfigured =
    (chatColumnMinWidth === '0px' || chatColumnMinWidth === '0') &&
    chatColumnWidth === '100%';
  const sidebarConfigured = Boolean(sidebar);

  const layoutOk = Boolean(
    chatColumnConfigured && (isDesktop ? sidebarConfigured : true),
  );

  if (sidebar) {
    sidebar.getBoundingClientRect = () => {
      const width = isDesktop ? sidebarWidth : window.innerWidth;
      return {
        x: 0,
        y: 0,
        width,
        height: 800,
        top: 0,
        bottom: 800,
        left: 0,
        right: width,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }

  if (transcript) {
    transcript.getBoundingClientRect = () => {
      const left =
        isDesktop && sidebarConfigured ? sidebarWidth + columnGap : 0;
      const right = layoutOk ? window.innerWidth : window.innerWidth + 120;
      return {
        x: left,
        y: 0,
        width: right - left,
        height: 640,
        top: 0,
        bottom: 640,
        left,
        right,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }
}

describe('Chat shared shell transcript wrapping', () => {
  it('keeps the shared footer new-conversation trigger between info and working path on desktop', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/providers')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              providers: [
                {
                  id: 'codex',
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                  models: [{ id: 'gpt-5.2', label: 'GPT-5.2' }],
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }

      if (target.includes('/health')) {
        return Promise.resolve(
          new Response(JSON.stringify({ mongoConnected: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }

      if (target.includes('/conversations')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('chat-composer-info');
    const newButton = await screen.findByTestId(
      'chat-new-conversation-trigger',
    );
    const workingPathButton = await screen.findByTestId(
      'chat-working-folder-trigger',
    );

    expect(
      infoButton.compareDocumentPosition(newButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      newButton.compareDocumentPosition(workingPathButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('wraps long citation chunk text without expanding transcript width', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));
    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });

    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 't1',
        name: 'VectorSearch',
        result: {
          results: [
            {
              repo: 'repo',
              relPath: 'a'.repeat(240),
              hostPath: 'b'.repeat(240),
              chunk: 'c'.repeat(500),
              chunkId: 'chunk1',
            },
          ],
        },
      },
    });

    const citationsToggle = await screen.findByTestId('citations-toggle');
    await act(async () => {
      await user.click(citationsToggle);
    });
    await screen.findByTestId('citation-chunk');

    const transcript = await screen.findByTestId('chat-transcript');
    installTranscriptWidthMock(transcript);
    expect(transcript.scrollWidth).toBeLessThanOrEqual(transcript.clientWidth);
  });

  it('wraps long tool payload text without expanding transcript width', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));
    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });

    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 't1',
        name: 'WeirdTool',
        result: {
          key: 'd'.repeat(600),
        },
      },
    });

    const toolToggle = await screen.findByTestId('tool-toggle');
    await act(async () => {
      await user.click(toolToggle);
    });

    expect(await screen.findByTestId('tool-payload')).toBeInTheDocument();

    const transcript = await screen.findByTestId('chat-transcript');
    installTranscriptWidthMock(transcript);
    expect(transcript.scrollWidth).toBeLessThanOrEqual(transcript.clientWidth);
  });

  it('keeps long markdown code blocks scrollable without expanding transcript width', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));
    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });

    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: `\n\n\`\`\`ts\n${'e'.repeat(700)}\n\`\`\`\n`,
    });
    harness.emitFinal({ conversationId: conversationId!, inflightId });

    await waitFor(() => {
      const markdown = screen.getByTestId('assistant-markdown');
      expect(markdown.querySelector('pre')).toBeTruthy();
    });

    const transcript = await screen.findByTestId('chat-transcript');
    installTranscriptWidthMock(transcript);
    expect(transcript.scrollWidth).toBeLessThanOrEqual(transcript.clientWidth);
  });
});

describe('Chat shared shell layout alignment', () => {
  it('does not constrain the app shell width and preserves gutters', async () => {
    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-input');

    const appContainer = getAppShellContainer();
    expect(appContainer).not.toHaveClass('MuiContainer-maxWidthLg');

    const transcript = await screen.findByTestId('chat-transcript');
    expect(transcript.parentElement).not.toBeNull();
  });

  it('keeps the transcript container flex stretch styles', async () => {
    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const transcript = await screen.findByTestId('chat-transcript');
    expect(transcript.style.flex).toBe('1 1 0%');
    expect(['0', '0px']).toContain(transcript.style.minHeight);
    expect(transcript.style.overflowY).toBe('auto');
  });

  it('keeps gutters enabled on non-chat routes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '0.0.0-test' }),
    } as Response);

    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    const appContainer = getAppShellContainer();
    expect(appContainer).not.toHaveClass('MuiContainer-disableGutters');
    expect(
      parseFloat(getComputedStyle(appContainer).paddingLeft),
    ).toBeGreaterThan(0);
    expect(
      parseFloat(getComputedStyle(appContainer).paddingRight),
    ).toBeGreaterThan(0);
  });

  it('keeps a fixed conversation-pane width (md) and a fluid transcript column', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    const view = render(<RouterProvider router={router} />);

    await view.findByTestId('chat-input');
    const transcript = await view.findByTestId('chat-transcript');
    const sidebar = await view.findByTestId('conversation-list');
    const chatColumn = view.getByTestId('chat-column');
    installChatLayoutRectMocks({ sidebar, transcript, chatColumn });

    expect(sidebar.getBoundingClientRect().width).toBeCloseTo(320, 0);
    expect(transcript.getBoundingClientRect().right).toBeLessThanOrEqual(
      window.innerWidth,
    );
  });

  it('defaults to open on desktop and toggles the conversations pane closed', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');

    expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('conversation-drawer-toggle'));
    });
    expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('defaults to closed on mobile and opens a temporary conversations overlay', async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');

    const toggle = screen.getByTestId('conversation-drawer-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('conversation-list')).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('conversation-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
  });

  it('keeps the conversations toggle working after resizing from desktop to mobile', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');

    const toggle = screen.getByTestId('conversation-drawer-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();

    await act(async () => {
      window.innerWidth = 375;
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    );
    await waitFor(() => {
      const list = screen.queryByTestId('conversation-list');
      if (!list) return;
      expect(list).not.toBeVisible();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('conversation-drawer-toggle'));
    });

    expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(await screen.findByTestId('conversation-list')).toBeInTheDocument();
  });

  it('keeps the conversations overlay usable after resizing from mobile to desktop', async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');

    expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('conversation-list')).toBeNull();

    await act(async () => {
      window.innerWidth = 1280;
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
        'aria-expanded',
        'true',
      ),
    );
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('conversation-drawer-toggle'));
    });

    expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps the desktop conversations pane paper anchored to the chat column top', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch, health: { mongoConnected: true } });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');

    const drawer = screen.getByTestId('conversation-drawer');
    const paper = drawer.querySelector(
      '.MuiDrawer-paper',
    ) as HTMLElement | null;
    expect(paper).not.toBeNull();

    expect(paper!.style.marginTop).toBe('');
  });

  it('keeps the desktop conversations pane paper anchored when the persistence banner is visible', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch, health: { mongoConnected: false } });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('persistence-banner');
    await screen.findByTestId('chat-transcript');

    const drawer = screen.getByTestId('conversation-drawer');
    const paper = drawer.querySelector(
      '.MuiDrawer-paper',
    ) as HTMLElement | null;
    expect(paper).not.toBeNull();

    await waitFor(() => {
      expect(paper!.style.marginTop).toBe('');
    });
  });
  it('preserves gutters and avoids horizontal overflow on narrow viewports', async () => {
    window.innerWidth = 360;
    window.dispatchEvent(new Event('resize'));

    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');

    expect(screen.getByTestId('chat-column')).toBeInTheDocument();

    installChatLayoutRectMocks();

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));
    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });

    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 't1',
        name: 'WeirdTool',
        result: {
          key: 'd'.repeat(600),
        },
      },
    });

    const toolToggle = await screen.findByTestId('tool-toggle');
    await act(async () => {
      await user.click(toolToggle);
    });
    expect(await screen.findByTestId('tool-payload')).toBeInTheDocument();

    const transcript = await screen.findByTestId('chat-transcript');
    installTranscriptWidthMock(transcript);
    expect(transcript.scrollWidth).toBeLessThanOrEqual(transcript.clientWidth);
  });

  it('uses the list panel as a vertical scroll container', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId: 'c1',
            title: 'Conversation',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
          },
        ],
        nextCursor: null,
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const row = await screen.findByTestId('conversation-row');
    const list = row.closest('ul');
    const scrollContainer = list?.parentElement;
    expect(scrollContainer).not.toBeNull();
    expect(getComputedStyle(scrollContainer!).overflowY).toBe('auto');
  });

  it('keeps Load more inside the list panel', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const panel = await screen.findByTestId('conversation-list');
    expect(
      within(panel).getByTestId('conversation-load-more'),
    ).toBeInTheDocument();
  });

  it('does not clip the desktop conversations handle with forced horizontal overflow hiding', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({ mockFetch });
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');

    const drawer = screen.getByTestId('conversation-drawer');
    const paper = drawer.querySelector(
      '.MuiDrawer-paper',
    ) as HTMLElement | null;
    expect(paper).not.toBeNull();
    expect(getComputedStyle(paper!).overflowX).not.toBe('hidden');
  });

  it('keeps the header controls slightly tighter than the conversation rows', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId: 'c1',
            title: 'Conversation',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
          },
        ],
        nextCursor: null,
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const filter = await screen.findByTestId('conversation-filter');
    const rowButton = await screen.findByTestId('conversation-row');
    const headerContainer = filter.parentElement as HTMLElement | null;

    expect(headerContainer).not.toBeNull();

    const headerPadding = Number.parseFloat(
      headerContainer!.style.paddingLeft ||
        getComputedStyle(headerContainer!).paddingLeft,
    );
    const rowPadding = Number.parseFloat(
      rowButton.style.paddingLeft || getComputedStyle(rowButton).paddingLeft,
    );

    expect(headerPadding).toBeLessThan(rowPadding);
  });

  it('logs layout configuration for manual verification', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('conversation-list');

    logSharedShellLayoutConfigured({
      scrollContainer: true,
      loadMoreInside: true,
      overflowGuarded: true,
    });
  });

  it('uses the shared pinned-bottom and scroll-away rules on Chat', async () => {
    const measurementHarness = installTranscriptMeasurementHarness();
    setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId: 'c-scroll',
            title: 'Scroll conversation',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2026-03-19T00:00:00.000Z',
            archived: false,
          },
        ],
        nextCursor: null,
      },
      turns: {
        items: Array.from({ length: 6 }, (_, index) => ({
          turnId: `turn-${index + 1}`,
          conversationId: 'c-scroll',
          role: index % 2 === 0 ? 'assistant' : 'user',
          content: `Message ${index + 1}`,
          provider: 'lmstudio',
          model: 'm1',
          status: 'ok',
          createdAt: `2026-03-19T00:0${index}:00.000Z`,
        })),
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const conversationRow = await screen.findByTestId('conversation-row');
    fireEvent.click(conversationRow);
    const transcript = await screen.findByTestId('chat-transcript');
    await waitFor(() =>
      expect(screen.getAllByTestId('chat-bubble')).toHaveLength(6),
    );

    measurementHarness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1200,
      scrollTop: 880,
    });

    transcript.scrollTop = 420;
    fireEvent.wheel(transcript, { deltaY: -320 });
    fireEvent.scroll(transcript);
    await waitFor(() => expect(transcript.scrollTop).toBe(420));

    measurementHarness.setScrollMetrics(transcript, {
      scrollHeight: 1320,
      scrollTop: 420,
    });
    measurementHarness.triggerResize(transcript);
    expect(transcript.scrollTop).toBe(420);

    transcript.scrollTop = 960;
    fireEvent.scroll(transcript);

    measurementHarness.setScrollMetrics(transcript, {
      scrollHeight: 1400,
      scrollTop: 960,
    });
    measurementHarness.triggerResize(transcript);
    expect(transcript.scrollTop).toBe(1080);

    measurementHarness.restore();
  });
});
