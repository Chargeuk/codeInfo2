import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetch = getFetchMock();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(
    mockJsonResponse(
      {
        status: 'started',
        agentName: 'planning_agent',
        commandName: 'smoke',
        conversationId: 'c1',
        modelId: 'gpt-5.1-codex-max',
      },
      { status: 202 },
    ),
  );
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

  it('includes sourceId when provided', async () => {
    await runAgentCommand({
      agentName: 'planning_agent',
      commandName: 'smoke',
      sourceId: '/data/repo-a',
    });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body).toHaveProperty('commandName', 'smoke');
    expect(body).toHaveProperty('sourceId', '/data/repo-a');
  });

  it('includes startStep when provided', async () => {
    await runAgentCommand({
      agentName: 'planning_agent',
      commandName: 'smoke',
      startStep: 2,
    });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body).toHaveProperty('commandName', 'smoke');
    expect(body).toHaveProperty('startStep', 2);
  });

  it('omits optional fields when not provided', async () => {
    await runAgentCommand({
      agentName: 'planning_agent',
      commandName: 'smoke',
    });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body).toHaveProperty('commandName', 'smoke');
    expect(body).not.toHaveProperty('startStep');
    expect(body).not.toHaveProperty('working_folder');
    expect(body).not.toHaveProperty('conversationId');
    expect(body).not.toHaveProperty('sourceId');
  });
});
