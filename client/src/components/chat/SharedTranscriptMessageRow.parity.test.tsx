import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ChatMessage } from '../../hooks/useChatStream';

const assistantMock = jest.fn(({ message }: { message: ChatMessage }) => (
  <div data-testid="assistant-stub">{message.id}</div>
));
const userMock = jest.fn(({ message }: { message: ChatMessage }) => (
  <div data-testid="user-stub">{message.id}</div>
));

await jest.unstable_mockModule('./AssistantTranscriptSlice', async () => ({
  __esModule: true,
  default: assistantMock,
}));

await jest.unstable_mockModule('./UserTranscriptBubble', async () => ({
  __esModule: true,
  default: userMock,
}));

const { default: SharedTranscriptMessageRow } = await import(
  './SharedTranscriptMessageRow'
);

describe('SharedTranscriptMessageRow parity', () => {
  beforeEach(() => {
    assistantMock.mockClear();
    userMock.mockClear();
  });

  it('delegates assistant rows to the assistant slice component', () => {
    render(
      <SharedTranscriptMessageRow
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: 'Assistant',
        }}
        activeToolsAvailable={false}
        citationsEnabled
        isStopping={false}
        citationsOpen={{}}
        thinkOpen={{}}
        toolOpen={{}}
        toolErrorOpen={{}}
        onToggleCitation={() => {}}
        onToggleThink={() => {}}
        onToggleTool={() => {}}
        onToggleToolError={() => {}}
        log={() => undefined}
      />,
    );

    expect(screen.getByTestId('assistant-stub')).toHaveTextContent(
      'assistant-1',
    );
    expect(assistantMock).toHaveBeenCalledTimes(1);
    expect(userMock).not.toHaveBeenCalled();
  });

  it('delegates user rows to the user bubble component', () => {
    render(
      <SharedTranscriptMessageRow
        message={{
          id: 'user-1',
          role: 'user',
          content: 'User',
        }}
        activeToolsAvailable={false}
        citationsEnabled
        isStopping={false}
        citationsOpen={{}}
        thinkOpen={{}}
        toolOpen={{}}
        toolErrorOpen={{}}
        onToggleCitation={() => {}}
        onToggleThink={() => {}}
        onToggleTool={() => {}}
        onToggleToolError={() => {}}
        log={() => undefined}
      />,
    );

    expect(screen.getByTestId('user-stub')).toHaveTextContent('user-1');
    expect(userMock).toHaveBeenCalledTimes(1);
    expect(assistantMock).not.toHaveBeenCalled();
  });
});
