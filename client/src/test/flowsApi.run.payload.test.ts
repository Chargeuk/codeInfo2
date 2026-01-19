import { jest } from '@jest/globals';

const mockFetch = jest.fn();

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
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
});

const { runFlow } = await import('../api/flows');

describe('Flows API runFlow payload', () => {
  it('includes working_folder and resumeStepPath when provided', async () => {
    await runFlow({
      flowName: 'daily',
      working_folder: '/abs/path',
      resumeStepPath: [1, 0],
    });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.working_folder).toBe('/abs/path');
    expect(body.resumeStepPath).toEqual([1, 0]);
  });

  it('omits optional payload fields when not provided', async () => {
    await runFlow({ flowName: 'daily' });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('working_folder');
    expect(body).not.toHaveProperty('resumeStepPath');
  });
});
