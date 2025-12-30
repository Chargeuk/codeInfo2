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
import { setupChatWsHarness } from './support/mockChatWs';

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
const { default: ChatPage } = await import('../pages/ChatPage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [{ path: 'chat', element: <ChatPage /> }],
  },
];

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

describe('Chat transcript layout wrapping', () => {
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
