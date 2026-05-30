import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

const sharedTranscriptSurfaces = ['chat', 'agents', 'flows'] as const;

describe('Shared transcript scroll and bottom-follow behavior', () => {
  it('renders transcript rows in chronological top-to-bottom order', async () => {
    render(
      <SharedTranscript
        surface="chat"
        conversationId="chronological-order"
        messages={[
          {
            id: 'user-1',
            role: 'user',
            content: 'Older user prompt',
            createdAt: '2026-03-19T00:00:00.000Z',
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Newer assistant reply',
            createdAt: '2026-03-19T00:01:00.000Z',
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

    const transcript = await screen.findByTestId('chat-transcript');
    const older = within(transcript).getByText('Older user prompt');
    const newer = within(transcript).getByText('Newer assistant reply');

    expect(
      older.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps a visible shared scrollbar affordance on the transcript container', async () => {
    render(
      <SharedTranscript
        surface="chat"
        conversationId="scrollbar-affordance"
        messages={buildMessages(6)}
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
    expect(transcript.style.overflowY).toBe('auto');
    expect(transcript.style.scrollbarWidth).toBe('thin');
    expect(transcript.style.scrollbarGutter).toBe('stable');
  });

  it('shows a jump-to-latest affordance when scrolled away and re-pins on click', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="chat"
        conversationId="jump-to-latest"
        messages={buildMessages(14)}
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
      height: 320,
      clientHeight: 320,
      scrollHeight: 1400,
      scrollTop: 1080,
    });

    act(() => {
      harness.setScrollMetrics(transcript, {
        scrollHeight: 1400,
        scrollTop: 720,
      });
      fireEvent.scroll(transcript);
    });

    const jumpButton = await screen.findByTestId('transcript-jump-to-latest');
    expect(jumpButton).toBeVisible();

    act(() => {
      fireEvent.click(jumpButton);
    });

    expect(transcript.scrollTop).toBe(1080);
    await waitFor(() =>
      expect(
        screen.queryByTestId('transcript-jump-to-latest'),
      ).not.toBeInTheDocument(),
    );

    harness.restore();
  });

  it.each(sharedTranscriptSurfaces)(
    'renders the jump-to-latest affordance outside the scroll container for %s',
    async (surface) => {
      const harness = installTranscriptMeasurementHarness();

      render(
        <SharedTranscript
          surface={surface}
          conversationId={`jump-overlay-${surface}`}
          messages={buildMessages(14)}
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
        height: 320,
        clientHeight: 320,
        scrollHeight: 1400,
        scrollTop: 1080,
      });

      act(() => {
        harness.setScrollMetrics(transcript, {
          scrollHeight: 1400,
          scrollTop: 720,
        });
        fireEvent.scroll(transcript);
      });

      const jumpButton = await screen.findByTestId('transcript-jump-to-latest');
      expect(jumpButton).toBeVisible();
      expect(transcript.contains(jumpButton)).toBe(false);

      harness.restore();
    },
  );

  it('opens an existing conversation at the bottom after history finishes loading', async () => {
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

    expect(transcript.scrollTop).toBe(1080);
    harness.restore();
  });

  it('keeps an existing conversation at the bottom while virtualized rows settle after load', async () => {
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
      scrollTop: 1080,
    });
    harness.setElementRect(measuredRow!, { height: 180 });
    harness.triggerResize(measuredRow!);

    await waitFor(() => expect(transcript.scrollTop).toBe(1260));
    harness.restore();
  });

  it('preserves a scrolled-away position on a later history refresh for the same conversation', async () => {
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
    harness.restore();
  });

  it('re-pins a newly selected conversation even when the previous conversation was scrolled away', async () => {
    const harness = installTranscriptMeasurementHarness();
    const conversationAMessages = buildMessages(18);
    const conversationBMessages = buildMessages(20).map((message) => ({
      ...message,
      id: `conversation-b-${message.id}`,
      content: `Conversation B ${message.content}`,
    }));

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-a"
        messages={conversationAMessages}
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

    const transcript = await screen.findByTestId('chat-transcript');
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1600,
      scrollTop: 1280,
    });

    transcript.scrollTop = 420;
    fireEvent.wheel(transcript, { deltaY: -320 });
    fireEvent.scroll(transcript);

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={conversationAMessages}
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

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={[]}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 320,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={conversationBMessages}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 2200,
      scrollTop: 0,
    });
    harness.triggerResize(transcript);

    expect(transcript.scrollTop).toBe(1880);
    harness.restore();
  });

  it('re-pins a same-length conversation selection after the previous conversation was scrolled away', async () => {
    const harness = installTranscriptMeasurementHarness();
    const conversationAMessages = buildMessages(18);
    const conversationBMessages = buildMessages(18).map((message) => ({
      ...message,
      id: `same-length-${message.id}`,
      content: `Same length ${message.content}`,
    }));

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-a"
        messages={conversationAMessages}
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

    const transcript = await screen.findByTestId('chat-transcript');
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1960,
      scrollTop: 1640,
    });

    transcript.scrollTop = 420;
    fireEvent.scroll(transcript);

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={[]}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 320,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={conversationBMessages}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1960,
      scrollTop: 0,
    });
    await waitFor(() => {
      harness.triggerResize(transcript);
      expect(transcript.scrollTop).toBe(1640);
    });
    harness.restore();
  });

  it('opens the first selected conversation at the bottom after an empty transcript state', async () => {
    const harness = installTranscriptMeasurementHarness();
    const conversationBMessages = buildMessages(20).map((message) => ({
      ...message,
      id: `fresh-selection-${message.id}`,
      content: `Fresh selection ${message.content}`,
    }));

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId={null}
        messages={[]}
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

    const transcript = await screen.findByTestId('chat-transcript');
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 320,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={[]}
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
        conversationId="conversation-b"
        messages={conversationBMessages}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 2200,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={conversationBMessages}
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

    await waitFor(() => expect(transcript.scrollTop).toBe(1880));
    harness.restore();
  });

  it('opens the first selected conversation at the bottom when loaded turns arrive without a loading-only pass', async () => {
    const harness = installTranscriptMeasurementHarness();
    const conversationBMessages = buildMessages(20).map((message) => ({
      ...message,
      id: `direct-load-${message.id}`,
      content: `Direct load ${message.content}`,
    }));

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId={null}
        messages={[]}
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

    const transcript = await screen.findByTestId('chat-transcript');
    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 320,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-b"
        messages={conversationBMessages}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 2200,
      scrollTop: 0,
    });
    harness.triggerResize(transcript);

    await waitFor(() => expect(transcript.scrollTop).toBe(1880));
    harness.restore();
  });

  it('keeps repinning a first direct long conversation while later virtualized growth still settles', async () => {
    const harness = installTranscriptMeasurementHarness();
    const conversationMessages = buildMessages(24).map((message) => ({
      ...message,
      id: `direct-growth-${message.id}`,
      content: `Direct growth ${message.content}`,
    }));

    const { rerender } = render(
      <SharedTranscript
        surface="agents"
        conversationId={null}
        messages={[]}
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
      height: 320,
      clientHeight: 320,
      scrollHeight: 320,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="agents"
        conversationId="conversation-direct-growth"
        messages={conversationMessages}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 3200,
      scrollTop: 1500,
    });
    fireEvent.scroll(transcript);

    harness.setScrollMetrics(transcript, {
      scrollHeight: 3600,
      scrollTop: 1500,
    });
    harness.triggerResize(transcript);

    await waitFor(() => expect(transcript.scrollTop).toBe(3280));
    harness.restore();
  });

  it('lets a reader scroll away after a first direct conversation selection without re-pinning on later resize', async () => {
    const harness = installTranscriptMeasurementHarness();
    const conversationMessages = buildMessages(20).map((message) => ({
      ...message,
      id: `direct-load-scroll-${message.id}`,
      content: `Direct load scroll ${message.content}`,
    }));

    const { rerender } = render(
      <SharedTranscript
        surface="chat"
        conversationId={null}
        messages={[]}
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
      height: 320,
      clientHeight: 320,
      scrollHeight: 320,
      scrollTop: 0,
    });

    rerender(
      <SharedTranscript
        surface="chat"
        conversationId="conversation-direct-scroll"
        messages={conversationMessages}
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

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 2200,
      scrollTop: 0,
    });
    harness.triggerResize(transcript);
    await waitFor(() => expect(transcript.scrollTop).toBe(1880));

    transcript.scrollTop = 420;
    fireEvent.wheel(transcript, { deltaY: -320 });
    fireEvent.scroll(transcript);
    await waitFor(() => expect(transcript.scrollTop).toBe(420));

    harness.setScrollMetrics(transcript, {
      scrollHeight: 2320,
      scrollTop: 420,
    });
    harness.triggerResize(transcript);

    expect(transcript.scrollTop).toBe(420);
    harness.restore();
  });

  it("keeps a reader's place when transcript growth happens below the viewport", async () => {
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

  it("keeps a reader's place when row growth occurs below the viewport", async () => {
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

  it('re-enables newest-message following when the user scrolls back near the bottom', async () => {
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

  it('follows the newest messages when row growth happens while already pinned near the bottom', async () => {
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
