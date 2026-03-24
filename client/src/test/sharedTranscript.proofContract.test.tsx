import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const logSpy = jest.fn();

await jest.unstable_mockModule('../logging/logger', async () => ({
  __esModule: true,
  createLogger: jest.fn(() => logSpy),
}));

const { default: SharedTranscript } = await import(
  '../components/chat/SharedTranscript'
);
const { installTranscriptMeasurementHarness } = await import(
  './support/transcriptMeasurementHarness'
);

function buildMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `assistant-${index + 1}`,
    role: 'assistant' as const,
    content: `Assistant message ${index + 1}`,
    createdAt: `2026-03-19T00:${String(index).padStart(2, '0')}:00.000Z`,
  }));
}

function renderTranscriptWithMessage(message: Record<string, unknown>) {
  return render(
    <SharedTranscript
      surface="chat"
      conversationId="partial-metadata"
      messages={[
        {
          id: 'assistant-partial',
          role: 'assistant',
          content: 'Assistant metadata sample',
          createdAt: '2026-03-23T00:00:00.000Z',
          ...message,
        },
      ]}
      activeToolsAvailable={false}
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
}

describe('Shared transcript proof contract', () => {
  beforeEach(() => {
    logSpy.mockReset();
  });

  it('uses T08 for scroll mode changes and T10 for anchor-preserving row growth', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="agents"
        conversationId="proof-contract"
        messages={buildMessages(10)}
        activeToolsAvailable={false}
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

    const transcript = await screen.findByTestId('chat-transcript');
    const measuredRow = transcript.querySelector(
      '[data-virtualized-message-id="assistant-5"]',
    ) as HTMLElement | null;

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1100,
      scrollTop: 360,
    });

    transcript.scrollTop = 360;
    fireEvent.scroll(transcript);

    harness.setScrollMetrics(transcript, {
      scrollHeight: 1250,
      scrollTop: 360,
    });
    expect(measuredRow).not.toBeNull();
    measuredRow!.dataset.virtualizedStart = '420';
    harness.setElementRect(measuredRow!, { height: 180 });
    harness.triggerResize(measuredRow!);

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        'info',
        'DEV-0000049:T10:virtualized_row_growth_settled',
        expect.objectContaining({
          surface: 'agents',
          conversationId: 'proof-contract',
          messageId: 'assistant-5',
          anchorPreserved: true,
        }),
      ),
    );

    expect(logSpy).toHaveBeenCalledWith(
      'info',
      'DEV-0000049:T08:shared_transcript_scroll_mode_changed',
      expect.objectContaining({
        surface: 'agents',
        conversationId: 'proof-contract',
        mode: 'scrolled-away',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'info',
      'DEV-0000049:T10:virtualized_row_remeasured',
      expect.objectContaining({
        surface: 'agents',
        conversationId: 'proof-contract',
        messageId: 'assistant-5',
        cause: 'content-or-toggle-change',
      }),
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      'info',
      'DEV-0000049:T08:shared_transcript_scroll_anchor_preserved',
      expect.anything(),
    );

    harness.restore();
  });

  it('renders partial Copilot timing metadata without placeholder timing values', async () => {
    renderTranscriptWithMessage({
      provider: 'copilot',
      usage: { inputTokens: 8, totalTokens: 13 },
      timing: { totalTimeSec: 1.25 },
    });

    expect(await screen.findByTestId('bubble-timing')).toHaveTextContent(
      'Time: 1.25s',
    );
    expect(screen.queryByText(/Rate:/i)).toBeNull();
    expect(logSpy).toHaveBeenCalledWith(
      'info',
      'story.0000051.task13.partial_metadata_rendered',
      expect.objectContaining({
        omittedFields: expect.arrayContaining(['timing.tokensPerSecond']),
      }),
    );
  });

  it('renders partial Copilot token metadata without placeholder token values', async () => {
    renderTranscriptWithMessage({
      provider: 'copilot',
      usage: { outputTokens: 5 },
      timing: { tokensPerSecond: 9.5 },
    });

    expect(await screen.findByTestId('bubble-tokens')).toHaveTextContent(
      'Tokens: out 5',
    );
    expect(screen.queryByText(/in 0/i)).toBeNull();
    expect(screen.queryByText(/total 0/i)).toBeNull();
  });

  it('omits null and undefined Copilot usage values instead of rendering zero placeholders', async () => {
    renderTranscriptWithMessage({
      provider: 'copilot',
      usage: {
        inputTokens: null,
        outputTokens: undefined,
        totalTokens: 4,
        cachedInputTokens: null,
      },
    });

    expect(await screen.findByTestId('bubble-tokens')).toHaveTextContent(
      'Tokens: total 4',
    );
    expect(screen.queryByText(/cached 0/i)).toBeNull();
    expect(screen.queryByText(/out 0/i)).toBeNull();
  });

  it('keeps existing Codex metadata rendering unchanged', async () => {
    renderTranscriptWithMessage({
      provider: 'codex',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 2,
      },
      timing: { totalTimeSec: 1.2, tokensPerSecond: 12.5 },
    });

    expect(await screen.findByTestId('bubble-tokens')).toHaveTextContent(
      'Tokens: in 10 · out 5 · total 15 · cached 2',
    );
    expect(screen.getByTestId('bubble-timing')).toHaveTextContent(
      'Time: 1.2s · Rate: 12.5 tok/s',
    );
  });
});
