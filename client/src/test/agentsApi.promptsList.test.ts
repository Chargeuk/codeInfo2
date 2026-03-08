import { jest } from '@jest/globals';
import {
  getFetchMock,
  mockJsonResponse,
  mockTextResponse,
} from './support/fetchMock';

const mockFetch = getFetchMock();
const mockConsoleInfo = jest.spyOn(console, 'info').mockImplementation(() => {
  // Silence expected observability logs in test output.
});

beforeAll(() => {
  global.fetch = mockFetch;
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
    mockFetch.mockResolvedValue(mockJsonResponse({ prompts: [] }));

    await listAgentPrompts({
      agentName: 'planning_agent',
      working_folder: '/tmp/repo',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(new URL(url).pathname).toBe('/agents/planning_agent/prompts');
    expect(init).toBeUndefined();
  });

  it('encodes working_folder query string safely', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ prompts: [] }));

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
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        prompts: [
          {
            relativePath: 'nested/start.md',
            fullPath: '/data/repo/.github/prompts/nested/start.md',
          },
        ],
      }),
    );

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
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'invalid_request',
          code: 'RUN_IN_PROGRESS',
          message: 'Already running',
        },
        { status: 409 },
      ),
    );

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
    mockFetch.mockResolvedValue(
      mockTextResponse('bad gateway from proxy', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    );

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
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'invalid_request',
          code: 'WORKING_FOLDER_INVALID',
          message: 'working_folder must be an absolute path',
        },
        { status: 400 },
      ),
    );

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
    mockFetch.mockResolvedValue(
      mockJsonResponse({ error: 'not_found' }, { status: 404 }),
    );

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
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'agent_prompts_failed',
          message: 'prompt discovery failed',
        },
        { status: 500 },
      ),
    );

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
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          code: 'WORKING_FOLDER_INVALID',
          message: 'working_folder must be an absolute path',
        },
        { status: 400 },
      ),
    );

    await expect(
      listAgentPrompts({
        agentName: 'planning_agent',
        working_folder: 'relative/path',
      }),
    ).rejects.toBeInstanceOf(AgentApiError);
  });
});
