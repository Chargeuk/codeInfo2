import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
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
  mockFetch.mockImplementation(
    asFetchImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/health')) {
        return mockJsonResponse({ mongoConnected: false });
      }
      if (url.includes('/chat/providers')) {
        return mockJsonResponse(providerPayload);
      }
      if (url.includes('/chat/models')) {
        return mockJsonResponse(modelPayload);
      }
      if (url.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }
      return mockJsonResponse({});
    }),
  );

  render(<ChatPage />);

  const banner = await screen.findByTestId('persistence-banner');
  expect(banner).toBeInTheDocument();
  expect(banner).toHaveTextContent(/conversation history unavailable/i);
  expect(screen.getByTestId('conversation-filter-active')).toBeDisabled();
  expect(screen.getByTestId('conversation-refresh')).toBeDisabled();
});
