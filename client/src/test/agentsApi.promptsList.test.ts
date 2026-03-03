import { jest } from '@jest/globals';

const mockFetch = jest.fn();
const mockConsoleInfo = jest.spyOn(console, 'info').mockImplementation(() => {
  // Silence expected observability logs in test output.
});

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  mockConsoleInfo.mockClear();
});

afterAll(() => {
  mockConsoleInfo.mockRestore();
});

const { AgentApiError, listAgentPrompts } = await import('../api/agents');

describe('Agents API listAgentPrompts', () => {
  it('calls GET /agents/:agentName/prompts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ prompts: [] }),
    } as unknown as Response);

    await listAgentPrompts({
      agentName: 'planning_agent',
      working_folder: '/tmp/repo',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(new URL(url).pathname).toBe('/agents/planning_agent/prompts');
    expect(init).toBeUndefined();
  });

  it('encodes working_folder query string safely', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ prompts: [] }),
    } as unknown as Response);

    await listAgentPrompts({
      agentName: 'planning_agent',
      working_folder: 'C:\\Users\\Test User\\repo folder',
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get('working_folder')).toBe(
      'C:\\Users\\Test User\\repo folder',
    );
  });

  it('parses success payload as { prompts }', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        prompts: [
          {
            relativePath: 'nested/start.md',
            fullPath: '/data/repo/.github/prompts/nested/start.md',
          },
        ],
      }),
    } as unknown as Response);

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: '/data/repo',
      }),
    ).resolves.toEqual({
      prompts: [
        {
          relativePath: 'nested/start.md',
          fullPath: '/data/repo/.github/prompts/nested/start.md',
        },
      ],
    });
  });

  it('maps JSON error responses to AgentApiError with code and message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'invalid_request',
        code: 'RUN_IN_PROGRESS',
        message: 'Already running',
      }),
    } as unknown as Response);

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: '/data/repo',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'RUN_IN_PROGRESS',
      message: 'Already running',
    });
  });

  it('falls back to text for non-JSON error responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => 'text/plain' },
      text: async () => 'bad gateway from proxy',
    } as unknown as Response);

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: '/data/repo',
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'Failed to list agent prompts (502): bad gateway from proxy',
    });
  });

  it('propagates fetch network rejections', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: '/data/repo',
      }),
    ).rejects.toThrow('network down');
  });

  it('maps 400 invalid_request responses from prompts route', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'invalid_request',
        code: 'WORKING_FOLDER_INVALID',
        message: 'working_folder must be an absolute path',
      }),
    } as unknown as Response);

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: 'relative/path',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'WORKING_FOLDER_INVALID',
      message: 'working_folder must be an absolute path',
    });
  });

  it('maps 404 not_found responses for unknown agent', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'not_found' }),
    } as unknown as Response);

    await expect(
      listAgentPrompts({
        agentName: 'missing_agent',
        working_folder: '/data/repo',
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: undefined,
      message: 'Failed to list agent prompts (404)',
    });
  });

  it('maps 500 agent_prompts_failed responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'agent_prompts_failed',
        message: 'prompt discovery failed',
      }),
    } as unknown as Response);

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: '/data/repo',
      }),
    ).rejects.toMatchObject({
      status: 500,
      code: undefined,
      message: 'prompt discovery failed',
    });
  });

  it('throws AgentApiError for HTTP failures', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({
        code: 'WORKING_FOLDER_INVALID',
        message: 'working_folder must be an absolute path',
      }),
    } as unknown as Response);

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: 'relative/path',
      }),
    ).rejects.toBeInstanceOf(AgentApiError);
  });
});
