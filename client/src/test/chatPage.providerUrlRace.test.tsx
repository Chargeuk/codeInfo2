import { jest } from '@jest/globals';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { mockJsonResponse } from './support/fetchMock';
import { setupChatWsHarness } from './support/mockChatWs';
import { createTestUser } from './support/userEvent';

const { default: App } = await import('../App');
const { default: ChatPage } = await import('../pages/ChatPage');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('keeps a user-selected provider in the URL while its distinct model catalog loads and sends that model', async () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn<typeof fetch>();
  const user = createTestUser();
  const lmStudioRequested = deferred<void>();
  const lmStudioResponse = deferred<Response>();
  const chatRequested = deferred<Record<string, unknown>>();
  const modelRequests: string[] = [];
  const lmStudioModels = () =>
    mockJsonResponse({
      provider: 'lmstudio',
      available: true,
      toolsAvailable: true,
      defaultModel: 'mock-1',
      models: [{ key: 'mock-1', displayName: 'mock-1', type: 'gguf' }],
    });
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [{ path: 'chat', element: <ChatPage /> }],
      },
    ],
    { initialEntries: ['/chat'] },
  );
  const urlSelection = () =>
    Object.fromEntries(new URLSearchParams(router.state.location.search));
  const selectionHistory: Record<string, string>[] = [];
  let unsubscribe: (() => void) | undefined;

  global.fetch = mockFetch;
  globalThis.__wsMock?.reset();
  try {
    const { chatBodies } = setupChatWsHarness({
      mockFetch,
      providers: {
        providers: [
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
        selectedProvider: 'copilot',
        selectedModel: 'copilot-gpt-5',
      },
      chatFetch: (body) => {
        chatRequested.resolve(body);
        return mockJsonResponse(
          {
            status: 'started',
            conversationId: body.conversationId,
            inflightId: body.inflightId,
            provider: body.provider,
            model: body.model,
          },
          { status: 202 },
        );
      },
    });
    const baseFetch = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname !== '/chat/models') return baseFetch(input, init);

      const provider = url.searchParams.get('provider') ?? '';
      modelRequests.push(provider);
      if (provider === 'lmstudio') {
        lmStudioRequested.resolve();
        return lmStudioResponse.promise;
      }
      if (provider === 'copilot') {
        return Promise.resolve(
          mockJsonResponse({
            provider: 'copilot',
            available: true,
            toolsAvailable: true,
            defaultModel: 'copilot-gpt-5',
            models: [
              {
                key: 'copilot-gpt-5',
                displayName: 'copilot-gpt-5',
                type: 'copilot',
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected model catalog request: ${provider}`);
    });

    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByTestId('chat-send')).toBeEnabled();
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        'copilot-gpt-5',
      );
      expect(urlSelection()).toEqual({
        provider: 'copilot',
        model: 'copilot-gpt-5',
      });
    });
    expect(modelRequests).toEqual(['copilot']);

    unsubscribe = router.subscribe(() => {
      selectionHistory.push(urlSelection());
    });
    // Both request waiters exist before the UI actions that can resolve them.
    await user.click(screen.getByTestId('provider-select'));
    await user.click(await screen.findByRole('option', { name: 'LM Studio' }));
    await lmStudioRequested.promise;

    // Hold the response here: the old URL must not restore Copilot or publish
    // its model under LM Studio while the new catalog is still unavailable.
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      'LM Studio',
    );
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    expect(urlSelection()).toEqual({ provider: 'lmstudio' });
    expect(selectionHistory.length).toBeGreaterThan(0);
    for (const selection of selectionHistory) {
      expect(selection).toEqual({ provider: 'lmstudio' });
    }
    expect(modelRequests).toEqual(['copilot', 'lmstudio']);
    expect(chatBodies).toHaveLength(0);

    await act(async () => {
      lmStudioResponse.resolve(lmStudioModels());
      await lmStudioResponse.promise;
    });
    await waitFor(() => {
      expect(screen.getByTestId('chat-send')).toBeEnabled();
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        'LM Studio',
      );
      expect(screen.getByTestId('model-select')).toHaveTextContent('mock-1');
      expect(urlSelection()).toEqual({ provider: 'lmstudio', model: 'mock-1' });
    });

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'Send with the selected LM Studio model' },
    });
    await user.click(screen.getByTestId('chat-send'));
    const body = await chatRequested.promise;
    expect(chatBodies).toHaveLength(1);
    expect(body).toMatchObject({
      provider: 'lmstudio',
      model: 'mock-1',
      conversationId: expect.any(String),
      inflightId: expect.any(String),
    });
    expect(body.endpointId).toBeUndefined();
    expect(urlSelection()).toMatchObject({
      provider: 'lmstudio',
      model: 'mock-1',
    });
    expect(modelRequests).toEqual(['copilot', 'lmstudio']);
    for (const selection of selectionHistory) {
      expect(selection.provider).toBe('lmstudio');
      expect([undefined, 'mock-1']).toContain(selection.model);
    }
  } finally {
    unsubscribe?.();
    try {
      await act(async () => {
        lmStudioResponse.resolve(lmStudioModels());
        await lmStudioResponse.promise;
      });
    } finally {
      cleanup();
      router.dispose();
      globalThis.__wsMock?.reset();
      global.fetch = originalFetch;
    }
  }
});
