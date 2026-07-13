import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ChatPage from '../pages/ChatPage';
import { ensureAgentFlagsPanelExpanded } from './support/ensureAgentFlagsPanelExpanded';
import { asFetchImplementation, mockJsonResponse } from './support/fetchMock';

const mockFetch = jest.fn<typeof fetch>();

function setMatchMedia(matches: boolean) {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }) as unknown as MediaQueryList,
  });

  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

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

test('chat send payload includes conversationId, message, provider, and model', async () => {
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

test('chat send payload includes endpointId when the selected model is endpoint-backed', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
    endpointId?: string;
  };
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
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
          selectedProvider: 'codex',
          selectedModel: 'gpt-5.1-codex-max',
          selectedEndpointId: 'https://alpha.example/v1',
        });
      }
      if (url.includes('/chat/models') && url.includes('provider=codex')) {
        return mockJsonResponse({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
              endpointId: 'https://alpha.example/v1',
            },
          ],
        });
      }
      if (url.includes('/chat/models')) {
        return mockJsonResponse({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
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
        return mockJsonResponse({ items: [] });
      }
      return mockJsonResponse({});
    }),
  );

  render(<ChatPage />);

  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /OpenAI Codex/i,
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId('model-select')).toHaveTextContent(
      /gpt-5\.1-codex-max/i,
    ),
  );

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello endpoint' } });
  await waitFor(() =>
    expect(screen.getByTestId('chat-send')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('chat-send'));

  await waitFor(() => expect(chatBody).not.toBeNull());
  if (!chatBody) {
    throw new Error('Expected chat request body to be captured');
  }

  expect(chatBody).toMatchObject({
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    endpointId: 'https://alpha.example/v1',
  });
});

test('chat send payload clears stale endpointId after switching to LM Studio', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
    endpointId?: string;
  };
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
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
          selectedProvider: 'codex',
          selectedModel: 'gpt-5.1-codex-max',
          selectedEndpointId: 'https://alpha.example/v1',
        });
      }
      if (url.includes('/chat/models') && url.includes('provider=codex')) {
        return mockJsonResponse({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          models: [
            {
              key: 'gpt-5.1-codex-max',
              displayName: 'gpt-5.1-codex-max',
              type: 'codex',
              endpointId: 'https://alpha.example/v1',
            },
          ],
        });
      }
      if (url.includes('/chat/models')) {
        return mockJsonResponse({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
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
        return mockJsonResponse({ items: [] });
      }
      return mockJsonResponse({});
    }),
  );

  render(<ChatPage />);
  const user = userEvent.setup();

  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /OpenAI Codex/i,
    ),
  );

  await user.click(screen.getByRole('combobox', { name: /provider/i }));
  await user.click(await screen.findByRole('option', { name: /LM Studio/i }));

  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /LM Studio/i,
    ),
  );

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello stale endpoint clear' } });
  await waitFor(() =>
    expect(screen.getByTestId('chat-send')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('chat-send'));

  await waitFor(() => expect(chatBody).not.toBeNull());
  if (!chatBody) {
    throw new Error('Expected chat request body to be captured');
  }

  expect(chatBody).toMatchObject({
    provider: 'lmstudio',
    model: 'lm',
  });
  expect(chatBody).not.toHaveProperty('endpointId');
});

test('chat send payload omits a stale endpointId on the compact mobile picker path', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
    endpointId?: string;
  };
  const restoreMatchMedia = setMatchMedia(true);
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
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
          selectedProvider: 'codex',
          selectedModel: 'gpt-5.2',
          selectedEndpointId: 'https://alpha.example/stale/v1',
        });
      }
      if (url.includes('/chat/models') && url.includes('provider=codex')) {
        return mockJsonResponse({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          providerInfo: {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
            defaultModel: 'gpt-5.2',
            defaultModelSource: 'config',
          },
          models: [
            {
              key: 'gpt-5.2',
              displayName: 'gpt-5.2',
              type: 'codex',
            },
            {
              key: 'gpt-5.2',
              displayName: 'gpt-5.2',
              type: 'codex',
              endpointId: 'https://alpha.example/alt/v1',
            },
          ],
        });
      }
      if (url.includes('/chat/models')) {
        return mockJsonResponse({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
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
        return mockJsonResponse({ items: [] });
      }
      return mockJsonResponse({});
    }),
  );

  try {
    const router = createMemoryRouter(
      [{ path: '/chat', element: <ChatPage /> }],
      { initialEntries: ['/chat'] },
    );
    render(<RouterProvider router={router} />);

    const providerButton = screen.getByTestId('provider-select');
    expect(providerButton).toHaveAttribute('aria-label', 'Provider');
    expect(providerButton).not.toHaveTextContent(/OpenAI Codex/i);

    const modelButton = screen.getByTestId('model-select');
    expect(modelButton).toHaveAttribute('aria-label', 'Model');
    expect(modelButton).not.toHaveTextContent(/alpha\.example/i);
    await waitFor(() => {
      const modelInput = modelButton.querySelector('input');
      expect(modelInput).not.toBeNull();
      expect(modelInput).toHaveValue('gpt-5.2');
    });

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, {
      target: { value: 'Hello mobile stale endpoint' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('chat-send')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(chatBody).not.toBeNull());
    if (!chatBody) {
      throw new Error('Expected chat request body to be captured');
    }

    expect(chatBody).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.2',
    });
    expect(chatBody).not.toHaveProperty('endpointId');
  } finally {
    restoreMatchMedia();
  }
});

test('chat send payload keeps the Copilot request provider-neutral without legacy top-level Codex fields', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
    agentFlags?: Record<string, unknown>;
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
          const copilotAgentFlags = [
            {
              key: 'modelReasoningEffort',
              label: 'Reasoning Effort',
              controlType: 'select',
              editable: true,
              seedDefault: 'medium',
              resolvedDefault: 'medium',
              supportedValues: [
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ],
            },
            {
              key: 'toolAccess',
              label: 'Tool Access',
              controlType: 'select',
              editable: true,
              seedDefault: 'on',
              resolvedDefault: 'on',
              supportedValues: [
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ],
            },
          ];
          return mockJsonResponse({
            provider: 'copilot',
            available: true,
            toolsAvailable: true,
            providerInfo: {
              id: 'copilot',
              label: 'GitHub Copilot',
              available: true,
              toolsAvailable: true,
              agentFlags: copilotAgentFlags,
            },
            agentFlags: copilotAgentFlags,
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
          providerInfo: {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
            agentFlags: [
              {
                key: 'sandboxMode',
                label: 'Sandbox Mode',
                controlType: 'select',
                editable: true,
                seedDefault: 'workspace-write',
                resolvedDefault: 'workspace-write',
                supportedValues: [
                  { value: 'workspace-write', label: 'Workspace write' },
                  { value: 'read-only', label: 'Read-only' },
                  {
                    value: 'danger-full-access',
                    label: 'Danger full access',
                  },
                ],
              },
              {
                key: 'approvalPolicy',
                label: 'Approval Policy',
                controlType: 'select',
                editable: true,
                seedDefault: 'on-request',
                resolvedDefault: 'on-request',
                supportedValues: [
                  { value: 'never', label: 'Never (auto-approve)' },
                  { value: 'on-request', label: 'On request' },
                  { value: 'untrusted', label: 'Untrusted' },
                ],
              },
              {
                key: 'modelReasoningEffort',
                label: 'Reasoning Effort',
                controlType: 'select',
                editable: true,
                seedDefault: 'high',
                resolvedDefault: 'high',
                supportedValues: [{ value: 'high', label: 'High' }],
              },
              {
                key: 'networkAccessEnabled',
                label: 'Network Access',
                controlType: 'boolean',
                editable: true,
                seedDefault: true,
                resolvedDefault: true,
              },
              {
                key: 'webSearchMode',
                label: 'Web Search',
                controlType: 'select',
                editable: true,
                seedDefault: 'live',
                resolvedDefault: 'live',
                supportedValues: [
                  { value: 'disabled', label: 'Disabled' },
                  { value: 'cached', label: 'Cached' },
                  { value: 'live', label: 'Live' },
                ],
              },
            ],
          },
          agentFlags: [
            {
              key: 'sandboxMode',
              label: 'Sandbox Mode',
              controlType: 'select',
              editable: true,
              seedDefault: 'workspace-write',
              resolvedDefault: 'workspace-write',
              supportedValues: [
                { value: 'workspace-write', label: 'Workspace write' },
                { value: 'read-only', label: 'Read-only' },
                {
                  value: 'danger-full-access',
                  label: 'Danger full access',
                },
              ],
            },
            {
              key: 'approvalPolicy',
              label: 'Approval Policy',
              controlType: 'select',
              editable: true,
              seedDefault: 'on-request',
              resolvedDefault: 'on-request',
              supportedValues: [
                { value: 'never', label: 'Never (auto-approve)' },
                { value: 'on-request', label: 'On request' },
                { value: 'untrusted', label: 'Untrusted' },
              ],
            },
            {
              key: 'modelReasoningEffort',
              label: 'Reasoning Effort',
              controlType: 'select',
              editable: true,
              seedDefault: 'high',
              resolvedDefault: 'high',
              supportedValues: [{ value: 'high', label: 'High' }],
            },
            {
              key: 'networkAccessEnabled',
              label: 'Network Access',
              controlType: 'boolean',
              editable: true,
              seedDefault: true,
              resolvedDefault: true,
            },
            {
              key: 'webSearchMode',
              label: 'Web Search',
              controlType: 'select',
              editable: true,
              seedDefault: 'live',
              resolvedDefault: 'live',
              supportedValues: [
                { value: 'disabled', label: 'Disabled' },
                { value: 'cached', label: 'Cached' },
                { value: 'live', label: 'Live' },
              ],
            },
          ],
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
  expect(submittedBody.agentFlags).toEqual({
    modelReasoningEffort: 'medium',
    toolAccess: 'on',
  });
  expect(submittedBody).not.toHaveProperty('sandboxMode');
  expect(submittedBody).not.toHaveProperty('approvalPolicy');
  expect(submittedBody).not.toHaveProperty('modelReasoningEffort');
  expect(submittedBody).not.toHaveProperty('networkAccessEnabled');
  expect(submittedBody).not.toHaveProperty('webSearchEnabled');
});

test('chat send payload omits hidden incompatible Codex values after switching to Copilot', async () => {
  type ChatBody = {
    conversationId?: string;
    message?: string;
    provider?: string;
    model?: string;
    agentFlags?: Record<string, unknown>;
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
          const copilotAgentFlags = [
            {
              key: 'modelReasoningEffort',
              label: 'Reasoning Effort',
              controlType: 'select',
              editable: true,
              seedDefault: 'medium',
              resolvedDefault: 'medium',
              supportedValues: [
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ],
            },
            {
              key: 'toolAccess',
              label: 'Tool Access',
              controlType: 'select',
              editable: true,
              seedDefault: 'on',
              resolvedDefault: 'on',
              supportedValues: [
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ],
            },
          ];
          return mockJsonResponse({
            provider: 'copilot',
            available: true,
            toolsAvailable: true,
            providerInfo: {
              id: 'copilot',
              label: 'GitHub Copilot',
              available: true,
              toolsAvailable: true,
              agentFlags: copilotAgentFlags,
            },
            agentFlags: copilotAgentFlags,
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
          providerInfo: {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
            agentFlags: [
              {
                key: 'sandboxMode',
                label: 'Sandbox Mode',
                controlType: 'select',
                editable: true,
                seedDefault: 'workspace-write',
                resolvedDefault: 'workspace-write',
                supportedValues: [
                  { value: 'workspace-write', label: 'Workspace write' },
                  { value: 'read-only', label: 'Read-only' },
                  {
                    value: 'danger-full-access',
                    label: 'Danger full access',
                  },
                ],
              },
              {
                key: 'approvalPolicy',
                label: 'Approval Policy',
                controlType: 'select',
                editable: true,
                seedDefault: 'on-request',
                resolvedDefault: 'on-request',
                supportedValues: [
                  { value: 'never', label: 'Never (auto-approve)' },
                  { value: 'on-request', label: 'On request' },
                  { value: 'untrusted', label: 'Untrusted' },
                ],
              },
              {
                key: 'modelReasoningEffort',
                label: 'Reasoning Effort',
                controlType: 'select',
                editable: true,
                seedDefault: 'high',
                resolvedDefault: 'high',
                supportedValues: [{ value: 'high', label: 'High' }],
              },
              {
                key: 'networkAccessEnabled',
                label: 'Network Access',
                controlType: 'boolean',
                editable: true,
                seedDefault: true,
                resolvedDefault: true,
              },
              {
                key: 'webSearchMode',
                label: 'Web Search',
                controlType: 'select',
                editable: true,
                seedDefault: 'live',
                resolvedDefault: 'live',
                supportedValues: [
                  { value: 'disabled', label: 'Disabled' },
                  { value: 'cached', label: 'Cached' },
                  { value: 'live', label: 'Live' },
                ],
              },
            ],
          },
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
    await screen.findByRole('option', { name: /^OpenAI Codex$/i }),
  );

  await ensureAgentFlagsPanelExpanded(user);
  const sandboxSelect = await screen.findByRole('combobox', {
    name: /sandbox mode/i,
  });
  await user.click(sandboxSelect);
  await user.click(
    await screen.findByRole('option', { name: /danger full access/i }),
  );
  await waitFor(() =>
    expect(screen.getByTestId('sandbox-mode-select')).toHaveTextContent(
      /danger full access/i,
    ),
  );

  await user.click(screen.getByRole('combobox', { name: /provider/i }));
  await user.click(
    await screen.findByRole('option', { name: /^GitHub Copilot$/i }),
  );
  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /GitHub Copilot/i,
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId('model-select')).toHaveTextContent(
      /Copilot Chat/i,
    ),
  );

  await ensureAgentFlagsPanelExpanded(user);
  await waitFor(() =>
    expect(
      screen.queryByRole('combobox', { name: /sandbox mode/i }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.getByTestId('tool-access-select')).toHaveTextContent(/on/i),
  );

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello Copilot after Codex' } });
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
  expect(submittedBody.agentFlags).toEqual({
    modelReasoningEffort: 'medium',
    toolAccess: 'on',
  });
  expect(submittedBody.agentFlags).not.toHaveProperty('sandboxMode');
  expect(submittedBody).not.toHaveProperty('sandboxMode');
  expect(submittedBody).not.toHaveProperty('approvalPolicy');
  expect(submittedBody).not.toHaveProperty('modelReasoningEffort');
  expect(submittedBody).not.toHaveProperty('networkAccessEnabled');
  expect(submittedBody).not.toHaveProperty('webSearchEnabled');
});
