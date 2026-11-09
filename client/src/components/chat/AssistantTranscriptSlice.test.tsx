import { jest } from '@jest/globals';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from '../../hooks/useChatStream';
import AssistantTranscriptSlice from './AssistantTranscriptSlice';

const log = () => undefined;

const exact = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));

function renderMessage(message: ChatMessage) {
  return render(
    <AssistantTranscriptSlice
      message={message}
      activeToolsAvailable={false}
      isStopping={false}
      citationsOpen={{}}
      thinkOpen={{}}
      toolOpen={{}}
      toolErrorOpen={{}}
      onToggleCitation={() => {}}
      onToggleThink={() => {}}
      onToggleTool={() => {}}
      onToggleToolError={() => {}}
      renderMetadataContent={() => <span>Existing execution metadata</span>}
      log={log}
    />,
  );
}

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

  describe('timestamp metadata', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-05-23T10:22:00.000Z'));
    });

    afterEach(() => {
      cleanup();
      jest.useRealTimers();
    });

    it('uses the last update for the footer and exact separate Info instants', async () => {
      const createdAt = '2026-05-23T08:00:03.000Z';
      const firstUpdateAt = '2026-05-23T08:00:07.000Z';
      const lastUpdateAt = '2026-05-23T10:21:01.000Z';
      renderMessage({
        id: 'assistant-updates',
        role: 'assistant',
        content: 'Assistant content.',
        streamStatus: 'complete',
        createdAt,
        firstUpdateAt,
        lastUpdateAt,
        timing: { totalTimeSec: 120.5 },
      });

      expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
        '59s ago',
      );
      expect(screen.getByTestId('bubble-response-time')).toHaveTextContent(
        '120.5s',
      );
      const infoButton = screen.getByRole('button', {
        name: 'Show message details',
      });
      await act(async () => {
        fireEvent.click(infoButton);
      });
      const popover = await screen.findByTestId('bubble-info-popover');
      expect(infoButton).toHaveAttribute('aria-expanded', 'true');
      expect(within(popover).getByTestId('bubble-info-time')).toHaveTextContent(
        `Time: ${exact(createdAt)}`,
      );
      expect(
        within(popover).getByTestId('bubble-info-first-update'),
      ).toHaveTextContent(`First update: ${exact(firstUpdateAt)}`);
      expect(
        within(popover).getByTestId('bubble-info-last-update'),
      ).toHaveTextContent(`Last update: ${exact(lastUpdateAt)}`);
      expect(
        within(popover).getByTestId('bubble-info-response-time'),
      ).toHaveTextContent('Response time: 120.5s');
      expect(
        within(popover).getByText('Existing execution metadata'),
      ).toBeVisible();
      expect(screen.getByTestId('bubble-copy')).toBeEnabled();

      act(() => jest.advanceTimersByTime(30_000));

      expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
        '1m ago',
      );
      expect(
        within(popover).getByTestId('bubble-info-last-update'),
      ).toHaveTextContent(`Last update: ${exact(lastUpdateAt)}`);
    });

    it('switches the last-update footer to exact time at the shared tick boundary', () => {
      const lastUpdateAt = '2026-05-23T08:52:01.000Z';
      renderMessage({
        id: 'assistant-boundary',
        role: 'assistant',
        content: 'Assistant content.',
        createdAt: '2026-05-23T08:00:03.000Z',
        lastUpdateAt,
      });
      expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
        '1h ago',
      );

      act(() => jest.advanceTimersByTime(30_000));

      expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
        exact(lastUpdateAt),
      );
    });

    it.each<{
      dates: Pick<ChatMessage, 'createdAt' | 'firstUpdateAt' | 'lastUpdateAt'>;
      footer: string;
    }>([
      { dates: { createdAt: '2026-05-23T10:21:00.000Z' }, footer: '1m ago' },
      { dates: {}, footer: '—' },
      { dates: { createdAt: 'invalid-date' }, footer: '—' },
      {
        dates: {
          createdAt: '2026-05-23T10:21:00.000Z',
          firstUpdateAt: 'invalid-date',
          lastUpdateAt: 'invalid-date',
        },
        footer: '—',
      },
    ])(
      'does not fabricate legacy update instants: $dates',
      async ({ dates, footer }) => {
        renderMessage({
          id: 'assistant-legacy',
          role: 'assistant',
          content: 'Legacy content.',
          ...dates,
        });
        expect(screen.getByTestId('bubble-completion-time')).toHaveTextContent(
          footer,
        );

        const infoButton = screen.getByRole('button', {
          name: 'Show message details',
        });
        await act(async () => {
          fireEvent.click(infoButton);
        });
        const popover = await screen.findByTestId('bubble-info-popover');
        expect(infoButton).toHaveAttribute('aria-expanded', 'true');
        expect(
          within(popover).queryByTestId('bubble-info-first-update'),
        ).toBeNull();
        expect(
          within(popover).queryByTestId('bubble-info-last-update'),
        ).toBeNull();
        const creationLabel =
          dates.createdAt && dates.createdAt !== 'invalid-date'
            ? exact(dates.createdAt)
            : '—';
        expect(
          within(popover).getByTestId('bubble-info-time'),
        ).toHaveTextContent(`Time: ${creationLabel}`);
      },
    );

    it.each(['firstUpdateAt', 'lastUpdateAt'] as const)(
      'shows a valid %s independently of the other invalid update instant',
      async (field) => {
        const timestamp = '2026-05-23T10:21:17.000Z';
        renderMessage({
          id: 'assistant-partial-updates',
          role: 'assistant',
          content: 'Partial metadata.',
          firstUpdateAt: 'invalid-date',
          lastUpdateAt: 'invalid-date',
          [field]: timestamp,
        });

        const infoButton = screen.getByRole('button', {
          name: 'Show message details',
        });
        await act(async () => {
          fireEvent.click(infoButton);
        });
        const popover = await screen.findByTestId('bubble-info-popover');
        expect(infoButton).toHaveAttribute('aria-expanded', 'true');
        const validId = field === 'firstUpdateAt' ? 'first' : 'last';
        const invalidId = field === 'firstUpdateAt' ? 'last' : 'first';
        expect(
          within(popover).getByTestId(`bubble-info-${validId}-update`),
        ).toHaveTextContent(exact(timestamp));
        expect(
          within(popover).queryByTestId(`bubble-info-${invalidId}-update`),
        ).toBeNull();
      },
    );

    it('retains the clicked anchor when Info toggles are queued before rendering', async () => {
      renderMessage({
        id: 'assistant-queued-info',
        role: 'assistant',
        content: 'Queued Info toggles.',
      });
      const infoButton = screen.getByRole('button', {
        name: 'Show message details',
      });

      await act(async () => {
        fireEvent.click(infoButton);
        fireEvent.click(infoButton);
        fireEvent.click(infoButton);
      });

      const popover = await screen.findByTestId('bubble-info-popover');
      expect(infoButton).toHaveAttribute('aria-expanded', 'true');
      expect(within(popover).getByText('Message details')).toBeVisible();

      await act(async () => {
        fireEvent.click(infoButton);
      });
      expect(infoButton).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
