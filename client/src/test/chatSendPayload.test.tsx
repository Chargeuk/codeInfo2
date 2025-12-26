import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatPage from '../pages/ChatPage';

const mockFetch = jest.fn();

beforeAll(() => {
  // @ts-expect-error jsdom lacks IntersectionObserver
  global.IntersectionObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof IntersectionObserver;
  global.fetch = mockFetch as unknown as typeof fetch;
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
  let chatBody: Record<string, unknown> | null = null;

  mockFetch.mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as Response;
      }
      if (url.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => providerPayload,
        }) as Response;
      }
      if (url.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => modelPayload,
        }) as Response;
      }
      if (url.includes('/chat')) {
        chatBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          body: streamFromFrames([
            'data: {"type":"final","message":{"role":"assistant","content":"hi"}}\n\n',
            'data: {"type":"complete"}\n\n',
          ]),
        }) as Response;
      }
      if (url.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        }) as Response;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Response;
    },
  );

  render(<ChatPage />);

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello world' } });
  await waitFor(() =>
    expect(screen.getByTestId('chat-send')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('chat-send'));

  await waitFor(() => expect(chatBody).not.toBeNull());

  expect(chatBody).toBeTruthy();
  expect(chatBody?.conversationId).toBeDefined();
  expect(chatBody?.message).toBe('Hello world');
  expect(chatBody?.provider).toBe('lmstudio');
  expect(chatBody?.model).toBe('m1');
  expect(chatBody).not.toHaveProperty('messages');
});
