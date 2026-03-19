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
import { ensureCodexFlagsPanelExpanded } from './support/ensureCodexFlagsPanelExpanded';
import { setupChatWsHarness } from './support/mockChatWs';

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

describe('Chat reasoning rendering (analysis_delta)', () => {
  it('keeps reasoning collapsed by default and toggles open', async () => {
    const harness = setupChatWsHarness({ mockFetch });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Show reasoning' } });
    const sendButton = screen.getByTestId('chat-send');

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
      assistantText: 'Answer',
      assistantThink: 'Thinking...\nSecond line',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    const toggle = await screen.findByTestId('think-toggle');
    expect(screen.queryByTestId('think-content')).toBeNull();

    await user.click(toggle);
    const thinkContent = await screen.findByTestId('think-content');
    await waitFor(() => expect(thinkContent).toBeVisible());
    expect(thinkContent.textContent ?? '').toContain('Thinking');
  });

  it('renders multi-block reasoning without dropping prefixes', async () => {
    const harness = setupChatWsHarness({ mockFetch });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, {
      target: { value: 'Show multi-block reasoning' },
    });
    const sendButton = screen.getByTestId('chat-send');

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
      assistantText: 'Answer',
      assistantThink: '',
    });
    harness.emitAnalysisDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Reasoning part A...',
    });
    harness.emitAnalysisDelta({
      conversationId: conversationId!,
      inflightId,
      delta: '\n\nNew block',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    const toggle = await screen.findByTestId('think-toggle');
    await user.click(toggle);

    const thinkContent = await screen.findByTestId('think-content');
    await waitFor(() => expect(thinkContent).toBeVisible());
    const content = thinkContent.textContent ?? '';
    expect(content).toContain('Reasoning part A');
    expect(content).toContain('New block');
  });

  it('resets shared thought-process state when the active conversation changes', async () => {
    const user = userEvent.setup();
    const harness = setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId: 'c1',
            title: 'Conversation 1',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
          },
          {
            conversationId: 'c2',
            title: 'Conversation 2',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-01T00:01:00.000Z',
            archived: false,
          },
        ],
        nextCursor: null,
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const rowOne = (await screen.findByText('Conversation 1')).closest(
      '[data-testid="conversation-row"]',
    );
    if (!rowOne) {
      throw new Error('Conversation 1 row not found');
    }
    await act(async () => {
      await user.click(rowOne);
    });

    harness.emitInflightSnapshot({
      conversationId: 'c1',
      inflightId: 'i1',
      assistantText: 'Answer One',
      assistantThink: 'Reasoning One',
    });
    harness.emitFinal({ conversationId: 'c1', inflightId: 'i1', status: 'ok' });

    await user.click(await screen.findByTestId('think-toggle'));
    expect(await screen.findByTestId('think-content')).toBeVisible();

    const rowTwo = (await screen.findByText('Conversation 2')).closest(
      '[data-testid="conversation-row"]',
    );
    if (!rowTwo) {
      throw new Error('Conversation 2 row not found');
    }
    await act(async () => {
      await user.click(rowTwo);
    });

    harness.emitInflightSnapshot({
      conversationId: 'c2',
      inflightId: 'i2',
      assistantText: 'Answer Two',
      assistantThink: 'Reasoning Two',
    });
    harness.emitFinal({ conversationId: 'c2', inflightId: 'i2', status: 'ok' });

    const secondToggle = await screen.findByTestId('think-toggle');
    expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('think-content')).toBeNull();
    expect(await screen.findByText('Answer Two')).toBeInTheDocument();
  });

  it('accepts runtime-provided reasoning effort when model capabilities include it', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const harness = setupChatWsHarness({
      mockFetch,
      providers: {
        providers: [
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
          },
        ],
      },
      models: {
        provider: 'codex',
        available: true,
        toolsAvailable: true,
        codexDefaults: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-failure',
          modelReasoningEffort: 'unsupported-runtime-value',
          networkAccessEnabled: true,
          webSearchEnabled: true,
        },
        codexWarnings: [],
        models: [
          {
            key: 'gpt-5.2-codex',
            displayName: 'gpt-5.2-codex',
            type: 'codex',
            supportedReasoningEfforts: ['unsupported-runtime-value'],
            defaultReasoningEffort: 'unsupported-runtime-value',
          },
        ],
      },
    });

    try {
      const user = userEvent.setup();
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      await ensureCodexFlagsPanelExpanded();
      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, {
        target: { value: 'Trigger unsupported effort' },
      });
      const sendButton = screen.getByTestId('chat-send');
      await waitFor(() => expect(sendButton).toBeEnabled());
      await act(async () => {
        await user.click(sendButton);
      });

      await waitFor(() => expect(harness.chatBodies.length).toBe(1));
      expect(harness.chatBodies[0]?.provider).toBe('codex');
      expect(harness.chatBodies[0]).not.toHaveProperty('modelReasoningEffort');
      expect(
        errorSpy.mock.calls.some(
          ([message]) =>
            typeof message === 'string' &&
            message.includes('[DEV-0000037][T16]') &&
            message.includes('result=error'),
        ),
      ).toBe(false);
      expect(
        infoSpy.mock.calls.some(
          ([message]) =>
            message ===
            '[DEV-0000037][T16] event=chat_model_capability_defaults_applied result=success',
        ),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});
