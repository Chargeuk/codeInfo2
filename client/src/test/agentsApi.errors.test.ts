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
});
