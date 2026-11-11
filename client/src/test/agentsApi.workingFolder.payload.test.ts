import { decodeJsonBody } from './support/decodeJsonBody';
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
        agentName: 'coding_agent',
        conversationId: 'c1',
        inflightId: 'i1',
        modelId: 'gpt-6-luna',
      },
      { status: 202 },
    ),
  );
});

const { runAgentInstruction } = await import('../api/agents');

describe('Agents API working_folder payload', () => {
  it('includes working_folder when provided', async () => {
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      working_folder: '/abs/path',
    });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const body = decodeJsonBody(init) as Record<string, unknown>;
    expect(body.working_folder).toBe('/abs/path');
  });

  it('omits working_folder when not provided (or blank)', async () => {
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      working_folder: undefined,
    });

    const [, initMissing] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const missingBody = decodeJsonBody(initMissing) as Record<string, unknown>;
    expect(missingBody).not.toHaveProperty('working_folder');

    mockFetch.mockClear();
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      working_folder: '   ',
    });

    const [, initBlank] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const blankBody = decodeJsonBody(initBlank) as Record<string, unknown>;
    expect(blankBody).not.toHaveProperty('working_folder');
  });
});

describe('Agents API client inflight correlation', () => {
  it('forwards a client inflightId and invokes beforeFetch before dispatch', async () => {
    const order: string[] = [];
    mockFetch.mockImplementation(async (_url, init) => {
      order.push('fetch');
      expect(decodeJsonBody(init)).toMatchObject({ inflightId: 'client-run' });
      return mockJsonResponse(
        {
          status: 'started',
          agentName: 'coding_agent',
          conversationId: 'c1',
          inflightId: 'client-run',
          modelId: 'm1',
        },
        { status: 202 },
      );
    });
    const accepted = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'hello',
      inflightId: 'client-run',
      beforeFetch: () => {
        order.push('beforeFetch');
      },
    });
    expect(order).toEqual(['beforeFetch', 'fetch']);
    expect(accepted.inflightId).toBe('client-run');
  });

  it('omits inflightId for legacy callers', async () => {
    await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'hello',
    });
    expect(decodeJsonBody(mockFetch.mock.calls[0][1])).not.toHaveProperty(
      'inflightId',
    );
  });

  it('rejects a started-shaped response without HTTP acceptance', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          status: 'started',
          agentName: 'coding_agent',
          conversationId: 'c1',
          inflightId: 'i1',
          modelId: 'm1',
        },
        { status: 200 },
      ),
    );
    await expect(
      runAgentInstruction({ agentName: 'coding_agent', instruction: 'hello' }),
    ).rejects.toThrow('Invalid agent run response');
  });
});
