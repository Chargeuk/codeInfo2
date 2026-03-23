import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatPage from '../pages/ChatPage';
import { asFetchImplementation, mockJsonResponse } from './support/fetchMock';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IntersectionObserver?: typeof IntersectionObserver;
    }
  ).IntersectionObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof IntersectionObserver;
  global.fetch = mockFetch;
});

afterEach(() => {
  mockFetch.mockReset();
});

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

function streamFromFrames(frames: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  });
}

test('chat send payload includes only conversationId and message', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
  };
  let chatBody: ChatBody | null = null;

  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      if (url.includes('/chat/providers')) {
        return mockJsonResponse(providerPayload);
      }
      if (url.includes('/chat/models')) {
        return mockJsonResponse(modelPayload);
      }
      if (url.includes('/chat')) {
        chatBody =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as ChatBody)
            : null;
        return new Response(
          streamFromFrames([
            'data: {"type":"final","message":{"role":"assistant","content":"hi"}}\n\n',
            'data: {"type":"complete"}\n\n',
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }
      return mockJsonResponse({});
    }),
  );

  render(<ChatPage />);

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello world' } });
  await waitFor(() =>
    expect(screen.getByTestId('chat-send')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('chat-send'));

  await waitFor(() => expect(chatBody).not.toBeNull());

  if (!chatBody) {
    throw new Error('Expected chat request body to be captured');
  }

  const submittedBody = chatBody as ChatBody;

  expect(submittedBody.conversationId).toBeDefined();
  expect(submittedBody.message).toBe('Hello world');
  expect(submittedBody.provider).toBe('lmstudio');
  expect(submittedBody.model).toBe('m1');
  expect(submittedBody).not.toHaveProperty('messages');
});

test('chat send payload includes working_folder when selected', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
    working_folder?: string;
  };
  let chatBody: ChatBody | null = null;

  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      if (url.includes('/chat/providers')) {
        return mockJsonResponse(providerPayload);
      }
      if (url.includes('/chat/models')) {
        return mockJsonResponse(modelPayload);
      }
      if (
        url.includes('/conversations/') &&
        url.includes('/working-folder') &&
        init?.method === 'POST'
      ) {
        return mockJsonResponse({
          status: 'ok',
          conversation: {
            conversationId: 'draft-conversation',
            title: 'Draft conversation',
            provider: 'lmstudio',
            model: 'm1',
            archived: false,
            flags: { workingFolder: '/repo/selected' },
          },
        });
      }
      if (url.includes('/chat')) {
        chatBody =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as ChatBody)
            : null;
        return new Response(
          streamFromFrames([
            'data: {"type":"final","message":{"role":"assistant","content":"hi"}}\n\n',
            'data: {"type":"complete"}\n\n',
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'draft-conversation',
              title: 'Draft conversation',
              provider: 'lmstudio',
              model: 'm1',
              lastMessageAt: '2025-01-01T00:00:00.000Z',
              flags: { workingFolder: '/repo/selected' },
            },
          ],
        });
      }
      return mockJsonResponse({});
    }),
  );

  render(<ChatPage />);

  const conversationRows = await screen.findAllByTestId('conversation-row');
  fireEvent.click(conversationRows[0]);

  const workingFolder = await screen.findByTestId('chat-working-folder');
  expect(workingFolder).toHaveValue('/repo/selected');

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello with folder' } });
  await waitFor(() =>
    expect(screen.getByTestId('chat-send')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('chat-send'));

  await waitFor(() => expect(chatBody).not.toBeNull());
  if (!chatBody) {
    throw new Error('Expected chat request body to be captured');
  }
  expect((chatBody as ChatBody).working_folder).toBe('/repo/selected');
});

test('chat send payload omits Codex-only flags when Copilot is selected', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    modelReasoningEffort?: string;
    networkAccessEnabled?: boolean;
    webSearchEnabled?: boolean;
  };
  const user = userEvent.setup();
  let chatBody: ChatBody | null = null;

  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      if (url.includes('/chat/providers')) {
        return mockJsonResponse({
          providers: [
            {
              id: 'codex',
              label: 'OpenAI Codex',
              available: true,
              toolsAvailable: true,
            },
            {
              id: 'copilot',
              label: 'GitHub Copilot',
              available: true,
              toolsAvailable: true,
            },
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
        });
      }
      if (url.includes('/chat/models')) {
        const providerId = new URL(url, 'http://localhost').searchParams.get(
          'provider',
        );
        if (providerId === 'copilot') {
          return mockJsonResponse({
            provider: 'copilot',
            available: true,
            toolsAvailable: true,
            models: [
              {
                key: 'copilot-chat',
                displayName: 'Copilot Chat',
                type: 'chat',
              },
            ],
          });
        }
        return mockJsonResponse({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          codexDefaults: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-failure',
            modelReasoningEffort: 'high',
            networkAccessEnabled: true,
            webSearchEnabled: true,
          },
          codexWarnings: [],
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
            },
          ],
        });
      }
      if (url.includes('/chat')) {
        chatBody =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as ChatBody)
            : null;
        return new Response(
          streamFromFrames([
            'data: {"type":"final","message":{"role":"assistant","content":"hi"}}\n\n',
            'data: {"type":"complete"}\n\n',
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/conversations')) {
        return mockJsonResponse({ items: [], nextCursor: null });
      }
      return mockJsonResponse({});
    }),
  );

  render(<ChatPage />);

  const providerSelect = await screen.findByRole('combobox', {
    name: /provider/i,
  });
  await user.click(providerSelect);
  await user.click(
    await screen.findByRole('option', { name: /^GitHub Copilot$/i }),
  );

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello Copilot' } });
  await waitFor(() =>
    expect(screen.getByTestId('chat-send')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('chat-send'));

  await waitFor(() => expect(chatBody).not.toBeNull());
  if (!chatBody) {
    throw new Error('Expected Copilot chat request body to be captured');
  }

  const submittedBody = chatBody as ChatBody;

  expect(submittedBody.provider).toBe('copilot');
  expect(submittedBody.model).toBe('copilot-chat');
  expect(submittedBody).not.toHaveProperty('sandboxMode');
  expect(submittedBody).not.toHaveProperty('approvalPolicy');
  expect(submittedBody).not.toHaveProperty('modelReasoningEffort');
  expect(submittedBody).not.toHaveProperty('networkAccessEnabled');
  expect(submittedBody).not.toHaveProperty('webSearchEnabled');
});
