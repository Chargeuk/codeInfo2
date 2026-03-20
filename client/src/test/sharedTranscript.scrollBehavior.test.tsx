import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import SharedTranscript from '../components/chat/SharedTranscript';
import { installTranscriptMeasurementHarness } from './support/transcriptMeasurementHarness';

function buildMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `assistant-${index + 1}`,
    role: 'assistant' as const,
    content: `Assistant message ${index + 1}`,
    createdAt: `2026-03-19T00:${String(index).padStart(2, '0')}:00.000Z`,
  }));
}

describe('Shared transcript scroll behavior', () => {
  it('opens an existing conversation at the top after history finishes loading', async () => {
    const harness = installTranscriptMeasurementHarness();

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId="existing-history"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading
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
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1400,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="existing-history"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading={false}
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

    expect(transcript.scrollTop).toBe(0);
    expect(transcript.scrollTop).not.toBe(1080);
    harness.restore();
  });

  it('keeps an existing conversation at the top while virtualized rows settle after load', async () => {
    const harness = installTranscriptMeasurementHarness();

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId="existing-history-growth"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading
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
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1400,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="existing-history-growth"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading={false}
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

    const measuredRow = transcript.querySelector(
      '[data-virtualized-message-id="assistant-5"]',
    ) as HTMLElement | null;

    expect(measuredRow).not.toBeNull();
    harness.setScrollMetrics(transcript, {
      scrollHeight: 1580,
      scrollTop: 0,
    });
    harness.setElementRect(measuredRow!, { height: 180 });
    harness.triggerResize(measuredRow!);

    await waitFor(() => expect(transcript.scrollTop).toBe(0));
    harness.restore();
  });

  it('does not jump back to the top on a later history refresh for the same conversation', async () => {
    const harness = installTranscriptMeasurementHarness();

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId="refresh-without-top-jump"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading
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
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1400,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="refresh-without-top-jump"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading={false}
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

    transcript.scrollTop = 360;
    fireEvent.scroll(transcript);

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="refresh-without-top-jump"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading
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

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="refresh-without-top-jump"
        messages={buildMessages(14)}
        activeToolsAvailable={false}
        turnsLoading={false}
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

    expect(transcript.scrollTop).toBe(360);
    expect(transcript.scrollTop).not.toBe(0);
    harness.restore();
  });

  it('leaves scrollTop unchanged when transcript growth happens below the viewport', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="chat"
        conversationId="scroll-away"
        messages={buildMessages(12)}
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
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 300,
      clientHeight: 300,
      scrollHeight: 1200,
      scrollTop: 900,
    });

    transcript.scrollTop = 400;
    fireEvent.scroll(transcript);

    harness.setScrollMetrics(transcript, {
      scrollHeight: 1300,
      scrollTop: 400,
    });
    harness.triggerResize(transcript);

    expect(transcript.scrollTop).toBe(400);
    expect(transcript.scrollTop).not.toBe(1000);
    harness.restore();
  });

  it('leaves scrollTop unchanged when row growth occurs below the viewport', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="agents"
        conversationId="below-viewport-growth"
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

    await waitFor(() => expect(transcript.scrollTop).toBe(360));
    harness.restore();
  });

  it('re-enables bottom pinning when the user scrolls back near the bottom', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="flows"
        conversationId="repinned"
        messages={buildMessages(9)}
        activeToolsAvailable={false}
        emptyMessage="Empty"
        citationsEnabled={false}
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
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 300,
      clientHeight: 300,
      scrollHeight: 1200,
      scrollTop: 900,
    });

    transcript.scrollTop = 450;
    fireEvent.scroll(transcript);

    transcript.scrollTop = 860;
    fireEvent.scroll(transcript);

    harness.setScrollMetrics(transcript, {
      scrollHeight: 1280,
      scrollTop: 860,
    });
    harness.triggerResize(transcript);

    expect(transcript.scrollTop).toBe(980);
    harness.restore();
  });

  it('keeps the transcript pinned to the bottom when row growth happens while pinned', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="chat"
        conversationId="pinned-row-growth"
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
      scrollTop: 780,
    });

    transcript.scrollTop = 780;
    fireEvent.scroll(transcript);

    harness.setScrollMetrics(transcript, {
      scrollHeight: 1280,
      scrollTop: 780,
    });
    expect(measuredRow).not.toBeNull();
    measuredRow!.dataset.virtualizedStart = '420';
    harness.setElementRect(measuredRow!, { height: 180 });
    harness.triggerResize(measuredRow!);

    await waitFor(() => expect(transcript.scrollTop).toBe(960));
    harness.restore();
  });

  it('ignores a missing row target after unmount without crashing', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="chat"
        conversationId="missing-row"
        messages={buildMessages(4)}
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
    const row = transcript.querySelector(
      '[data-virtualized-message-id="assistant-2"]',
    );

    expect(row).toBeTruthy();
    act(() => {
      row?.remove();
    });

    expect(() => harness.triggerResize(row)).not.toThrow();
    expect(screen.getByTestId('chat-transcript')).toBeInTheDocument();
    harness.restore();
  });
});
