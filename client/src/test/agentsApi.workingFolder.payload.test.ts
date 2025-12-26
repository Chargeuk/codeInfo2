import { jest } from '@jest/globals';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      agentName: 'coding_agent',
      conversationId: 'c1',
      modelId: 'gpt-5.1-codex-max',
      segments: [],
    }),
  } as unknown as Response);
});

const { runAgentInstruction } = await import('../api/agents');

describe('Agents API working_folder payload', () => {
  it('includes working_folder when provided', async () => {
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      working_folder: '/abs/path',
    });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.working_folder).toBe('/abs/path');
  });

  it('omits working_folder when not provided (or blank)', async () => {
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      working_folder: undefined,
    });

    const [, initMissing] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const missingBody = JSON.parse(initMissing.body as string) as Record<
      string,
      unknown
    >;
    expect(missingBody).not.toHaveProperty('working_folder');

    mockFetch.mockClear();
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      working_folder: '   ',
    });

    const [, initBlank] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const blankBody = JSON.parse(initBlank.body as string) as Record<
      string,
      unknown
    >;
    expect(blankBody).not.toHaveProperty('working_folder');
  });
});
