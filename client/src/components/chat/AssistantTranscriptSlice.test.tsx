import { jest } from '@jest/globals';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssistantTranscriptSlice from './AssistantTranscriptSlice';

const log = () => undefined;

function isBefore(a: Element, b: Element) {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function usingMockTimers() {
  try {
    jest.getTimerCount();
    return true;
  } catch {
    return false;
  }
}

async function flushUiTimersIfNeeded() {
  if (!usingMockTimers()) {
    return;
  }
  if (typeof jest.runOnlyPendingTimersAsync === 'function') {
    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });
    return;
  }
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe('AssistantTranscriptSlice', () => {
  it('renders a full-width assistant slice with the required footer contract', async () => {
    const user = userEvent.setup();
    render(
      <AssistantTranscriptSlice
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: 'Assistant content.',
          provider: 'codex',
          model: 'gpt-5',
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            cachedInputTokens: 2,
            totalTokens: 18,
          },
          timing: {
            totalTimeSec: 1.2,
          },
          streamStatus: 'processing',
          createdAt: '2026-05-23T00:00:00.000Z',
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
        log={log}
      />,
    );

    const bubble = await screen.findByTestId('chat-bubble');
    const slice = within(bubble).getByTestId('assistant-transcript-slice');

    expect(window.getComputedStyle(slice).backgroundColor).toBe(
      'rgb(243, 248, 255)',
    );
    expect(
      ['0px', ''].includes(window.getComputedStyle(slice).borderWidth),
    ).toBe(true);
    expect(window.getComputedStyle(slice).width).toBe('100%');

    const infoButton = within(bubble).getByTestId('bubble-info');
    const responseTime = within(bubble).getByTestId('bubble-response-time');
    const statusChip = within(bubble).getByTestId('status-chip');
    const completionTime = within(bubble).getByTestId('bubble-completion-time');
    const copyButton = within(bubble).getByTestId('bubble-copy');
    const footer = within(bubble).getByTestId('assistant-transcript-footer');

    expect(within(bubble).queryByText(/Provider:/i)).toBeNull();
    expect(within(bubble).queryByText(/Model:/i)).toBeNull();
    expect(window.getComputedStyle(footer).flexWrap).toBe('nowrap');
    expect(infoButton).toHaveTextContent('Info');
    expect(copyButton).toHaveTextContent('Copy');

    expect(isBefore(infoButton, responseTime)).toBe(true);
    expect(isBefore(responseTime, statusChip)).toBe(true);
    expect(isBefore(statusChip, completionTime)).toBe(true);
    expect(isBefore(completionTime, copyButton)).toBe(true);
    expect(within(bubble).getByTestId('status-chip')).toHaveTextContent(
      'Working',
    );

    await user.click(infoButton);
    await flushUiTimersIfNeeded();

    const popover = await screen.findByTestId('bubble-info-popover');
    expect(within(popover).getByText('Message details')).toBeInTheDocument();
    expect(
      within(popover).getByTestId('bubble-info-section-context'),
    ).toBeInTheDocument();
    expect(
      within(popover).getByTestId('bubble-info-section-usage'),
    ).toBeInTheDocument();
    expect(
      within(popover).getByTestId('bubble-info-provider'),
    ).toHaveTextContent('Provider: codex');
    expect(within(popover).getByTestId('bubble-info-model')).toHaveTextContent(
      'Model: gpt-5',
    );
    expect(
      within(popover).getByTestId('bubble-info-tokens-in'),
    ).toHaveTextContent('Tokens in: 11');
    expect(
      within(popover).getByTestId('bubble-info-tokens-out'),
    ).toHaveTextContent('Tokens out: 7');
    expect(within(popover).getByTestId('bubble-info-cached')).toHaveTextContent(
      'Cached: 2',
    );
    expect(within(popover).getByTestId('bubble-info-total')).toHaveTextContent(
      'Total: 18',
    );
  });
});
