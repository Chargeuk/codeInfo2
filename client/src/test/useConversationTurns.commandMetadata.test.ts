import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import useConversationTurns from '../hooks/useConversationTurns';

const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockApi(params: {
  items?: Array<Record<string, unknown>>;
  inflight?: Record<string, unknown> | null;
}) {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: params.items ?? [],
          inflight: params.inflight ?? null,
          nextCursor: undefined,
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });
}

function TestCommandTurn() {
  const { turns } = useConversationTurns('c1');
  const turn = turns[0];
  const label = turn?.command
    ? `${turn.command.name} (${turn.command.stepIndex}/${turn.command.totalSteps})`
    : 'none';

  return createElement('div', null, label);
}

test('preserves command metadata in StoredTurn', async () => {
  mockApi({
    items: [
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Assistant reply',
        model: 'm1',
        provider: 'codex',
        toolCalls: null,
        status: 'ok',
        command: {
          name: 'improve_plan',
          stepIndex: 2,
          totalSteps: 12,
        },
        createdAt: '2025-01-02T00:00:00Z',
      },
    ],
  });

  render(createElement(TestCommandTurn));

  expect(await screen.findByText('improve_plan (2/12)')).toBeInTheDocument();
});

function TestUsageTurn() {
  const { turns } = useConversationTurns('c1');
  const turn = turns[0];
  const usageLabel = turn?.usage
    ? `usage:${turn.usage.inputTokens ?? 0}/${turn.usage.outputTokens ?? 0}/${turn.usage.totalTokens ?? 0}`
    : 'usage:none';
  const timingLabel = turn?.timing
    ? `timing:${turn.timing.totalTimeSec ?? 0}/${turn.timing.tokensPerSecond ?? 0}`
    : 'timing:none';
  return createElement('div', null, `${usageLabel} ${timingLabel}`);
}

test('preserves usage/timing metadata in StoredTurn', async () => {
  mockApi({
    items: [
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Assistant reply',
        model: 'm1',
        provider: 'codex',
        toolCalls: null,
        status: 'ok',
        usage: {
          inputTokens: 9,
          outputTokens: 3,
          totalTokens: 12,
          cachedInputTokens: 2,
        },
        timing: {
          totalTimeSec: 0.4,
        },
        createdAt: '2025-01-02T00:00:00Z',
      },
    ],
  });

  render(createElement(TestUsageTurn));

  expect(
    await screen.findByText('usage:9/3/12 timing:0.4/0'),
  ).toBeInTheDocument();
});

test('omits usage/timing metadata when missing', async () => {
  mockApi({
    items: [
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Assistant reply',
        model: 'm1',
        provider: 'codex',
        toolCalls: null,
        status: 'ok',
        createdAt: '2025-01-02T00:00:00Z',
      },
    ],
  });

  render(createElement(TestUsageTurn));

  expect(await screen.findByText('usage:none timing:none')).toBeInTheDocument();
});

function TestInflightCommand() {
  const { inflight } = useConversationTurns('c1');
  const label = inflight?.command
    ? `${inflight.command.name} (${inflight.command.stepIndex}/${inflight.command.totalSteps})`
    : 'no-command';
  return createElement('div', null, label);
}

test('preserves inflight command metadata from REST snapshot', async () => {
  mockApi({
    items: [],
    inflight: {
      inflightId: 'i1',
      assistantText: 'hello',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2025-01-02T00:00:00Z',
      seq: 4,
      command: { name: 'improve_plan', stepIndex: 1, totalSteps: 3 },
    },
  });

  render(createElement(TestInflightCommand));

  expect(await screen.findByText('improve_plan (1/3)')).toBeInTheDocument();
});

test('omits inflight command metadata when missing', async () => {
  mockApi({
    items: [],
    inflight: {
      inflightId: 'i1',
      assistantText: 'hello',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2025-01-02T00:00:00Z',
      seq: 4,
    },
  });

  render(createElement(TestInflightCommand));

  expect(await screen.findByText('no-command')).toBeInTheDocument();
});
