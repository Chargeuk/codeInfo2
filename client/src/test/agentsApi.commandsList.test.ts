import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetch = getFetchMock();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

const { listAgentCommands } = await import('../api/agents');

describe('Agents API listAgentCommands', () => {
  it('calls GET /agents/:agentName/commands', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ commands: [] }));

    await listAgentCommands('planning_agent');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(new URL(url).pathname).toBe('/agents/planning_agent/commands');
    expect(init).toBeUndefined();
  });

  it('returns parsed { commands } including disabled entries', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        commands: [
          {
            name: 'smoke',
            description: 'Smoke command',
            disabled: false,
            stepCount: 3,
            sourceId: '/data/repo-a',
            sourceLabel: 'Repo A',
          },
          {
            name: 'broken',
            description: 'Invalid command',
            disabled: true,
            stepCount: 1,
          },
        ],
      }),
    );

    const result = await listAgentCommands('planning_agent');

    expect(result).toEqual({
      commands: [
        {
          name: 'smoke',
          description: 'Smoke command',
          disabled: false,
          stepCount: 3,
          sourceId: '/data/repo-a',
          sourceLabel: 'Repo A',
        },
        {
          name: 'broken',
          description: 'Invalid command',
          disabled: true,
          stepCount: 1,
        },
      ],
    });
  });

  it('rejects commands payloads missing required stepCount', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        commands: [{ name: 'smoke', description: 'Smoke', disabled: false }],
      }),
    );

    await expect(listAgentCommands('planning_agent')).rejects.toThrow(
      'Invalid agent commands response',
    );
  });

  it('rejects commands payloads with stepCount = 0', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        commands: [
          {
            name: 'smoke',
            description: 'Smoke',
            disabled: false,
            stepCount: 0,
          },
        ],
      }),
    );

    await expect(listAgentCommands('planning_agent')).rejects.toThrow(
      'Invalid agent commands response',
    );
  });

  it('rejects commands payloads with negative stepCount', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        commands: [
          {
            name: 'smoke',
            description: 'Smoke',
            disabled: false,
            stepCount: -2,
          },
        ],
      }),
    );

    await expect(listAgentCommands('planning_agent')).rejects.toThrow(
      'Invalid agent commands response',
    );
  });

  it('rejects commands payloads with non-numeric stepCount', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        commands: [
          {
            name: 'smoke',
            description: 'Smoke',
            disabled: false,
            stepCount: '3',
          },
        ],
      }),
    );

    await expect(listAgentCommands('planning_agent')).rejects.toThrow(
      'Invalid agent commands response',
    );
  });
});
