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
      agentName: 'planning_agent',
      commandName: 'smoke',
      conversationId: 'c1',
      modelId: 'gpt-5.1-codex-max',
    }),
  } as unknown as Response);
});

const { runAgentCommand } = await import('../api/agents');

describe('Agents API runAgentCommand', () => {
  it('calls POST /agents/:agentName/commands/run with JSON body', async () => {
    await runAgentCommand({
      agentName: 'planning_agent',
      commandName: 'smoke',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/agents/planning_agent/commands/run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ commandName: 'smoke' });
  });

  it('omits optional fields when not provided', async () => {
    await runAgentCommand({
      agentName: 'planning_agent',
      commandName: 'smoke',
    });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body).toHaveProperty('commandName', 'smoke');
    expect(body).not.toHaveProperty('working_folder');
    expect(body).not.toHaveProperty('conversationId');
  });
});
