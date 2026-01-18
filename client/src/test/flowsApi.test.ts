import { jest } from '@jest/globals';

const mockFetch = jest.fn();

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

const { listFlows, runFlow } = await import('../api/flows');

describe('Flows API helpers', () => {
  it('calls GET /flows for listFlows', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ flows: [] }),
    } as unknown as Response);

    await listFlows();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(new URL(url).pathname).toBe('/flows');
    expect(init).toBeUndefined();
  });

  it('returns parsed flow summaries', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        flows: [
          {
            name: 'daily',
            description: 'Daily flow',
            disabled: false,
          },
          {
            name: 'broken',
            description: 'Broken',
            disabled: true,
            error: 'Invalid flow file',
          },
          { name: 42 },
        ],
      }),
    } as unknown as Response);

    const result = await listFlows();

    expect(result).toEqual({
      flows: [
        { name: 'daily', description: 'Daily flow', disabled: false },
        {
          name: 'broken',
          description: 'Broken',
          disabled: true,
          error: 'Invalid flow file',
        },
      ],
    });
  });

  it('throws when listFlows returns non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);

    await expect(listFlows()).rejects.toThrow('Failed to load flows (500)');
  });

  it('calls POST /flows/:flowName/run and parses success payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        status: 'started',
        flowName: 'daily',
        conversationId: 'c1',
        inflightId: 'i1',
        modelId: 'gpt-5.2-codex',
      }),
    } as unknown as Response);

    const result = await runFlow({ flowName: 'daily' });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/flows/daily/run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({});
    expect(result).toEqual({
      status: 'started',
      flowName: 'daily',
      conversationId: 'c1',
      inflightId: 'i1',
      modelId: 'gpt-5.2-codex',
    });
  });

  it('surfaces structured errors for runFlow', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => 'application/json' },
      json: async () => ({
        code: 'RUN_IN_PROGRESS',
        message: 'Already running',
      }),
    } as unknown as Response);

    await expect(runFlow({ flowName: 'daily' })).rejects.toMatchObject({
      status: 409,
      code: 'RUN_IN_PROGRESS',
    });
  });
});
