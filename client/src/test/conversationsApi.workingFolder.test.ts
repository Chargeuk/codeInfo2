import { jest } from '@jest/globals';
import { updateConversationWorkingFolder } from '../api/conversations';
import { asFetchImplementation, mockJsonResponse } from './support/fetchMock';

const originalFetch = global.fetch;
const mockFetch = jest.fn<typeof fetch>();

describe('conversations API working folder payload', () => {
  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('sends the save payload for an existing conversation working folder', async () => {
    let requestBody: Record<string, unknown> | null = null;

    mockFetch.mockImplementation(
      asFetchImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        requestBody =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        return mockJsonResponse({
          status: 'ok',
          conversation: {
            conversationId: 'conv-1',
            title: 'Conversation 1',
            provider: 'lmstudio',
            model: 'm1',
            archived: false,
            flags: { workingFolder: '/repo/one' },
          },
        });
      }),
    );

    await updateConversationWorkingFolder({
      conversationId: 'conv-1',
      workingFolder: '/repo/one',
    });

    const [url] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain('/conversations/conv-1/working-folder');
    expect(requestBody).toEqual({ workingFolder: '/repo/one' });
  });

  it('sends the clear payload when the saved working folder is removed', async () => {
    let requestBody: Record<string, unknown> | null = null;

    mockFetch.mockImplementation(
      asFetchImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        requestBody =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        return mockJsonResponse({
          status: 'ok',
          conversation: {
            conversationId: 'conv-1',
            title: 'Conversation 1',
            provider: 'lmstudio',
            model: 'm1',
            archived: false,
            flags: {},
          },
        });
      }),
    );

    await updateConversationWorkingFolder({
      conversationId: 'conv-1',
      workingFolder: null,
    });

    const [url] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain('/conversations/conv-1/working-folder');
    expect(requestBody).toEqual({ workingFolder: null });
  });

  it('rejects omitted workingFolder values before sending a request', async () => {
    await expect(
      updateConversationWorkingFolder({
        conversationId: 'conv-1',
        workingFolder: undefined as unknown as string | null,
      }),
    ).rejects.toThrow('workingFolder must be a non-empty string or null');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects blank workingFolder strings before sending a request', async () => {
    await expect(
      updateConversationWorkingFolder({
        conversationId: 'conv-1',
        workingFolder: '   ',
      }),
    ).rejects.toThrow('workingFolder must be a non-empty string or null');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
