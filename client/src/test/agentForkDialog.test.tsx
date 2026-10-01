import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockJsonResponse } from './support/fetchMock';

const fetchMock = jest.fn<typeof fetch>();
const { default: AgentForkDialog } = await import(
  '../components/agents/AgentForkDialog'
);
const { default: AgentConversationMenu } = await import(
  '../components/agents/AgentConversationMenu'
);
const options = {
  sourceTurnId: 'server-selected-response',
  sourceTitle: 'Source conversation title',
  sourceAgentName: 'same_agent',
  estimated: true,
  agents: [
    { name: 'same_agent', sameAgent: true },
    { name: 'target_agent', sameAgent: false },
  ],
};
const result = {
  conversationId: 'child-conversation',
  agentName: 'target_agent',
  model: 'model',
  estimated: true,
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

test('dialog exposes source title, searchable compatible agents, same-agent label, and estimated notice', async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValue(mockJsonResponse(options));
  render(
    <AgentForkDialog
      conversationId="source"
      onClose={() => {}}
      onCreated={() => {}}
    />,
  );
  expect(await screen.findByText(options.sourceTitle)).toBeInTheDocument();
  const input = screen.getByRole('combobox', { name: 'Target agent' });
  expect(input).toHaveValue('same_agent (Same agent)');
  expect(
    screen.getByText(/Older history lacks exact provider IDs/),
  ).toBeInTheDocument();
  await user.clear(input);
  await user.type(input, 'target');
  expect(
    await screen.findByRole('option', { name: 'target_agent' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'same_agent (Same agent)' }),
  ).not.toBeInTheDocument();
});

test('pending creation disables cancellation and duplicate sends, then navigates to the returned child', async () => {
  const user = userEvent.setup();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  fetchMock
    .mockResolvedValueOnce(mockJsonResponse(options))
    .mockReturnValueOnce(pending);
  const created = jest.fn();
  render(
    <AgentForkDialog
      conversationId="source"
      sourceTurnId="completed-turn"
      onClose={() => {}}
      onCreated={created}
    />,
  );
  await screen.findByRole('combobox');
  await user.click(screen.getByRole('button', { name: 'Create fork' }));
  expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const body = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
  expect(body.sourceTurnId).toBe('completed-turn');
  expect(body.requestId).toEqual(expect.any(String));
  await act(async () => {
    finish(mockJsonResponse(result));
  });
  await waitFor(() => expect(created).toHaveBeenCalledWith(result));
});

test('inline failure allows retry with the same request identity and no duplicate visible handover', async () => {
  const user = userEvent.setup();
  fetchMock
    .mockResolvedValueOnce(mockJsonResponse(options))
    .mockResolvedValueOnce(
      mockJsonResponse(
        { code: 'FORK_CREATING', message: 'Retry this request' },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(mockJsonResponse(result));
  const created = jest.fn();
  render(
    <AgentForkDialog
      conversationId="source"
      onClose={() => {}}
      onCreated={created}
    />,
  );
  await screen.findByRole('combobox');
  await user.click(screen.getByRole('button', { name: 'Create fork' }));
  expect(await screen.findByText('Retry this request')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Create fork' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(result));
  expect(
    JSON.parse(fetchMock.mock.calls[1][1]!.body as string).sourceTurnId,
  ).toBe('server-selected-response');
  expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).requestId).toBe(
    JSON.parse(fetchMock.mock.calls[2][1]!.body as string).requestId,
  );
});

test('row menu retains archive/restore and exposes fork through keyboard navigation', async () => {
  const user = userEvent.setup();
  const fork = jest.fn();
  const archive = jest.fn();
  const restore = jest.fn();
  const { rerender } = render(
    <AgentConversationMenu
      archived={false}
      disabled={false}
      onFork={fork}
      onArchive={archive}
      onRestore={restore}
    />,
  );
  await user.tab();
  await user.keyboard('{Enter}');
  expect(
    screen.getByRole('menuitem', { name: 'Archive conversation' }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('menuitem', { name: 'Fork conversation...' }),
  );
  expect(fork).toHaveBeenCalledTimes(1);
  rerender(
    <AgentConversationMenu
      archived
      disabled={false}
      onFork={fork}
      onArchive={archive}
      onRestore={restore}
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'Conversation actions' }),
  );
  await user.click(
    screen.getByRole('menuitem', { name: 'Restore conversation' }),
  );
  expect(restore).toHaveBeenCalledTimes(1);
  expect(archive).not.toHaveBeenCalled();
});
