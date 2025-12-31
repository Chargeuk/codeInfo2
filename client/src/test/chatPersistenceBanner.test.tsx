import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
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
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
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

test('shows persistence banner and disables archive controls when mongo is down', async () => {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ mongoConnected: false }),
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
  });

  render(<ChatPage />);

  const banner = await screen.findByTestId('persistence-banner');
  expect(banner).toBeInTheDocument();
  expect(banner).toHaveTextContent(/conversation history unavailable/i);
  expect(screen.getByTestId('conversation-filter-active')).toBeDisabled();
});
