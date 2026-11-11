import { jest } from '@jest/globals';
import {
  ConversationsApiError,
  getConversationSummary,
} from '../api/conversations';
import { mockJsonResponse } from './support/fetchMock';

const originalFetch = global.fetch;
const mockFetch = jest.fn<typeof fetch>();
const summary = {
  conversationId: 'old /&? conversation',
  title: 'Archived conversation',
  provider: 'codex',
  model: 'saved-model',
  archived: true,
  flags: { endpointId: 'endpoint-1', workingFolder: '/saved' },
};

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('looks up an encoded exact ID across all states without sidebar scope or paging', async () => {
  mockFetch.mockResolvedValue(mockJsonResponse({ items: [summary] }));
  await expect(
    getConversationSummary(summary.conversationId),
  ).resolves.toMatchObject(summary);
  const url = new URL(String(mockFetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe('/conversations');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    conversationId: summary.conversationId,
    state: 'all',
  });
  expect(mockFetch.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET');
});

it('returns no summary when the exact target is missing', async () => {
  mockFetch.mockResolvedValue(mockJsonResponse({ items: [summary] }));
  await expect(getConversationSummary('missing')).resolves.toBeUndefined();
  mockFetch.mockResolvedValue(mockJsonResponse({ items: [] }));
  await expect(getConversationSummary('missing')).resolves.toBeUndefined();
});

it('uses the existing summary parser', async () => {
  mockFetch.mockResolvedValue(
    mockJsonResponse({ items: [{ ...summary, flags: [] }] }),
  );
  await expect(getConversationSummary(summary.conversationId)).rejects.toThrow(
    'Invalid conversation response',
  );
});

it('preserves the existing structured API error details', async () => {
  mockFetch.mockResolvedValue(
    mockJsonResponse(
      { code: 'UNAVAILABLE', message: 'History unavailable' },
      { status: 503 },
    ),
  );
  await expect(getConversationSummary('a')).rejects.toMatchObject({
    name: ConversationsApiError.name,
    status: 503,
    code: 'UNAVAILABLE',
    message: 'History unavailable',
  });
});
