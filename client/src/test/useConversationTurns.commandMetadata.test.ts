import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import useConversationTurns from '../hooks/useConversationTurns';

const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockApi() {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
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
  mockApi();

  render(createElement(TestCommandTurn));

  expect(await screen.findByText('improve_plan (2/12)')).toBeInTheDocument();
});
