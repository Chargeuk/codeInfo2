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
  it('stops auto-scroll after the user scrolls away from the bottom', async () => {
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

    expect(transcript.scrollTop).toBe(500);
    expect(transcript.scrollTop).not.toBe(1000);
    harness.restore();
  });

  it('preserves the reader position when row growth occurs', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="agents"
        conversationId="anchor-preserved"
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
    harness.setElementRect(measuredRow, { height: 180 });
    harness.triggerResize(measuredRow);

    await waitFor(() => expect(transcript.scrollTop).toBe(540));
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
