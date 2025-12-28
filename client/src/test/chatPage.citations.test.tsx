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

afterEach(() => {
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

describe('Chat citations rendering', () => {
  it('renders citations with repo/relPath and hostPath', async () => {
    const providerPayload = {
      providers: [
        {
          id: 'lmstudio',
          label: 'LM Studio',
          available: true,
          toolsAvailable: true,
        },
      ],
    };

    const modelPayload = {
      provider: 'lmstudio',
      available: true,
      toolsAvailable: true,
      models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
    };

    const harness = setupChatWsHarness({
      mockFetch,
      providers: providerPayload,
      models: modelPayload,
    });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(modelSelect).toBeEnabled());
    const input = await screen.findByTestId('chat-input');
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: 'Question?' } });
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
    });
    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 'c1',
        name: 'VectorSearch',
        stage: 'success',
        result: {
          results: [
            {
              repo: 'repo',
              relPath: 'docs/main.txt',
              hostPath: '/host/repo/docs/main.txt',
              chunk: 'fixture chunk',
              chunkId: 'chunk-1',
              modelId: 'text-embedding-qwen3-embedding-4b',
            },
          ],
          modelId: 'text-embedding-qwen3-embedding-4b',
        },
      },
    });

    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Here is what I found',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    expect(
      await screen.findByText(/Here is what I found/i),
    ).toBeInTheDocument();

    const toggle = await screen.findByTestId('citations-toggle');
    expect(toggle).toHaveTextContent('Citations (1)');
    expect(screen.getByTestId('citations')).not.toBeVisible();

    await user.click(toggle);
    const pathRow = await screen.findByTestId('citation-path');
    expect(pathRow).toHaveTextContent(
      'repo/docs/main.txt (/host/repo/docs/main.txt)',
    );
    const chunk = await screen.findByTestId('citation-chunk');
    expect(chunk).toHaveTextContent('fixture chunk');
  });
});
