import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetch = getFetchMock();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

const { runAgentInstruction, runAgentCommand } = await import('../api/agents');

describe('Agents API structured errors', () => {
  it('runAgentInstruction throws structured error for 409 RUN_IN_PROGRESS', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          code: 'RUN_IN_PROGRESS',
          message: 'Already running',
        },
        { status: 409 },
      ),
    );

    await expect(
      runAgentInstruction({
        agentName: 'planning_agent',
        instruction: 'Hello',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'RUN_IN_PROGRESS',
    });
  });

  it('runAgentCommand throws structured error for 409 RUN_IN_PROGRESS', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          code: 'RUN_IN_PROGRESS',
          message: 'Already running',
        },
        { status: 409 },
      ),
    );

    await expect(
      runAgentCommand({
        agentName: 'planning_agent',
        commandName: 'improve_plan',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'RUN_IN_PROGRESS',
    });
  });

  it('runAgentInstruction preserves server reason text when /agents/:agentName/run omits message', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          code: 'PROVIDER_UNAVAILABLE',
          reason: 'Copilot is unavailable. Re-authenticate and try again.',
        },
        { status: 503 },
      ),
    );

    await expect(
      runAgentInstruction({
        agentName: 'planning_agent',
        instruction: 'Hello',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Copilot is unavailable. Re-authenticate and try again.',
    });
  });

  it('runAgentCommand preserves server reason text when /agents/:agentName/commands/run omits message', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          code: 'AGENT_DISABLED',
          reason: 'Selected agent is disabled until a usable provider returns.',
        },
        { status: 409 },
      ),
    );

    await expect(
      runAgentCommand({
        agentName: 'planning_agent',
        commandName: 'improve_plan',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'AGENT_DISABLED',
      message: 'Selected agent is disabled until a usable provider returns.',
    });
  });
});
