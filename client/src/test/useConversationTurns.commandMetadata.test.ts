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
    ? `${turn.command.name}|${turn.command.stepIndex}/${turn.command.totalSteps}|${
        turn.command.label ?? ''
      }|${turn.command.agentType ?? ''}|${turn.command.identifier ?? ''}|${
        turn.command.loopDepth ?? ''
      }`
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
          name: 'flow',
          stepIndex: 2,
          totalSteps: 12,
          loopDepth: 1,
          label: 'Draft outline',
          agentType: 'planning_agent',
          identifier: 'main',
        },
        createdAt: '2025-01-02T00:00:00Z',
      },
    ],
  });

  render(createElement(TestCommandTurn));

  expect(
    await screen.findByText('flow|2/12|Draft outline|planning_agent|main|1'),
  ).toBeInTheDocument();
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
    ? `${inflight.command.name}|${inflight.command.stepIndex}/${
        inflight.command.totalSteps
      }|${inflight.command.label ?? ''}|${inflight.command.agentType ?? ''}|${
        inflight.command.identifier ?? ''
      }|${inflight.command.loopDepth ?? ''}`
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
      command: {
        name: 'flow',
        stepIndex: 1,
        totalSteps: 3,
        loopDepth: 0,
        label: 'Step one',
        agentType: 'planning_agent',
        identifier: 'main',
      },
    },
  });

  render(createElement(TestInflightCommand));

  expect(
    await screen.findByText('flow|1/3|Step one|planning_agent|main|0'),
  ).toBeInTheDocument();
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
