import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import SharedTranscript from '../components/chat/SharedTranscript';
import { buildSharedTranscriptCopyText } from '../components/chat/sharedTranscriptCopyText';

const clipboardWriteText = jest.fn<(text: string) => Promise<void>>();

describe('Shared transcript visible-content copy contract', () => {
  beforeEach(() => {
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  it('serializes only visible text segments into the clipboard payload', () => {
    const result = buildSharedTranscriptCopyText({
      content: 'Fallback body',
      segments: [
        {
          id: 'seg-1',
          kind: 'text',
          content: 'Visible paragraph one.',
        },
        {
          id: 'tool-1',
          kind: 'tool',
          tool: {
            id: 'tool-1',
            name: 'repo_search',
            status: 'done',
            payload: {
              hidden: 'must not be copied',
            },
          },
        },
        {
          id: 'seg-2',
          kind: 'text',
          content: 'Visible paragraph two.',
        },
      ],
    });

    expect(result).toBe('Visible paragraph one.\n\nVisible paragraph two.');
  });

  it('copies only visible message content and excludes footer metadata, status labels, warnings, and tool details', async () => {
    render(
      <SharedTranscript
        surface="chat"
        conversationId="copy-contract"
        messages={[
          {
            id: 'assistant-copy',
            role: 'assistant',
            content: 'Visible fallback body',
            createdAt: '2026-03-23T00:00:00.000Z',
            provider: 'codex',
            warnings: ['Provider warning'],
            usage: {
              inputTokens: 8,
              totalTokens: 13,
            },
            timing: {
              totalTimeSec: 2.5,
              tokensPerSecond: 12,
            },
            streamStatus: 'complete',
            segments: [
              {
                id: 'seg-1',
                kind: 'text',
                content: 'Visible paragraph one.',
              },
              {
                id: 'tool-1',
                kind: 'tool',
                tool: {
                  id: 'tool-1',
                  name: 'repo_search',
                  status: 'done',
                  payload: {
                    hidden: 'must not be copied',
                  },
                  parameters: {
                    query: 'hidden-tool-detail',
                  },
                },
              },
              {
                id: 'seg-2',
                kind: 'text',
                content: 'Visible paragraph two.',
              },
            ],
            tools: [
              {
                id: 'tool-1',
                name: 'repo_search',
                status: 'done',
                payload: {
                  hidden: 'must not be copied',
                },
                parameters: {
                  query: 'hidden-tool-detail',
                },
              },
            ],
          },
        ]}
        activeToolsAvailable
        emptyMessage="Empty"
        citationsOpen={{}}
        thinkOpen={{}}
        toolOpen={{}}
        toolErrorOpen={{}}
        onToggleCitation={() => {}}
        onToggleThink={() => {}}
        onToggleTool={() => {}}
        onToggleToolError={() => {}}
      />,
    );

    const bubble = await screen.findByTestId('chat-bubble');
    expect(within(bubble).getByTestId('status-chip')).toHaveTextContent(
      'Complete',
    );

    fireEvent.click(within(bubble).getByTestId('bubble-info'));

    const infoPopover = await screen.findByTestId('bubble-info-popover');
    expect(
      within(infoPopover).getByTestId('bubble-info-provider'),
    ).toHaveTextContent('Provider: codex');
    expect(
      within(infoPopover).getByTestId('bubble-info-timing'),
    ).toHaveTextContent('Timing: Time: 2.5s · Rate: 12 tok/s');
    expect(
      within(infoPopover).getByText('Provider warning'),
    ).toBeInTheDocument();
    expect(screen.queryByText('hidden-tool-detail')).toBeNull();
    expect(screen.queryByText('must not be copied')).toBeNull();

    fireEvent.click(within(bubble).getByTestId('bubble-copy'));

    await waitFor(() =>
      expect(clipboardWriteText).toHaveBeenCalledWith(
        'Visible paragraph one.\n\nVisible paragraph two.',
      ),
    );
    expect(
      await within(bubble).findByTestId('bubble-copy-feedback'),
    ).toHaveTextContent('Copied visible message content.');
  });
});
