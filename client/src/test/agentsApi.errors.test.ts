import { jest } from '@jest/globals';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

const { runAgentInstruction, runAgentCommand } = await import('../api/agents');

describe('Agents API structured errors', () => {
  it('runAgentInstruction throws structured error for 409 RUN_IN_PROGRESS', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => 'application/json' },
      json: async () => ({
        code: 'RUN_IN_PROGRESS',
        message: 'Already running',
      }),
    } as unknown as Response);

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
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => 'application/json' },
      json: async () => ({
        code: 'RUN_IN_PROGRESS',
        message: 'Already running',
      }),
    } as unknown as Response);

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
