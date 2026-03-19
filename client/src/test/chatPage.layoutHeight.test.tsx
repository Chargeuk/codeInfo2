import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import SharedTranscript from '../components/chat/SharedTranscript';
import { installTranscriptMeasurementHarness } from './support/transcriptMeasurementHarness';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: ChatPage } = await import('../pages/ChatPage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [{ path: 'chat', element: <ChatPage /> }],
  },
];

function setViewportHeight(value: number) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value,
  });
  window.dispatchEvent(new Event('resize'));
}

function installTranscriptHeightMock(
  harness: ReturnType<typeof installTranscriptMeasurementHarness>,
  options: {
    controlsHeight: number;
    minTranscriptHeight?: number;
  },
) {
  const transcript = screen.getByTestId('chat-transcript') as HTMLElement;
  const chatControls = screen.getByTestId('chat-controls') as HTMLElement;

  const layoutConfigured =
    transcript.style.flex === '1 1 0%' &&
    (transcript.style.minHeight === '0px' ||
      transcript.style.minHeight === '0') &&
    transcript.style.overflowY === 'auto' &&
    chatControls.style.flex === '0 0 auto';

  const updateMetrics = () => {
    const minTranscriptHeight = options.minTranscriptHeight ?? 0;
    const computedHeight = Math.max(
      minTranscriptHeight,
      window.innerHeight - options.controlsHeight,
    );

    const height = layoutConfigured ? computedHeight : 320;
    harness.setContainerMetrics(transcript, {
      width: 640,
      height,
      clientHeight: height,
      scrollHeight: height,
      scrollTop: transcript.scrollTop,
    });
    harness.setElementRect(chatControls, {
      width: 640,
      height: options.controlsHeight,
    });
  };

  updateMetrics();

  return { transcript, updateMetrics };
}

describe('Chat transcript viewport height fill', () => {
  it('grows when the viewport height increases', async () => {
    const harness = installTranscriptMeasurementHarness();
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (target.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (target.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            providers: [
              {
                id: 'lmstudio',
                label: 'LM Studio',
                available: true,
                toolsAvailable: true,
              },
            ],
          }),
        }) as unknown as Response;
      }
      if (target.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [
              {
                key: 'm1',
                displayName: 'Model 1',
                type: 'gguf',
                supportedReasoningEfforts: ['low'],
                defaultReasoningEffort: 'low',
              },
            ],
          }),
        }) as unknown as Response;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('chat-transcript');
    await waitFor(() =>
      expect(screen.getByTestId('chat-controls')).toBeTruthy(),
    );

    setViewportHeight(700);
    const { transcript, updateMetrics } = installTranscriptHeightMock(harness, {
      controlsHeight: 260,
    });
    const height700 = transcript.getBoundingClientRect().height;
    expect(height700).toBe(440);

    setViewportHeight(900);
    updateMetrics();
    const height900 = transcript.getBoundingClientRect().height;
    expect(height900).toBe(640);

    expect(height900).toBeGreaterThan(height700);
    harness.restore();
  });

  it('keeps transcript height non-negative with tall controls (Codex flags expanded)', async () => {
    const harness = installTranscriptMeasurementHarness();
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (target.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (target.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            providers: [
              {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
              },
            ],
          }),
        }) as unknown as Response;
      }
      if (target.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            models: [
              {
                key: 'c1',
                displayName: 'Codex Model',
                type: 'codex',
                supportedReasoningEfforts: ['high'],
                defaultReasoningEffort: 'high',
              },
            ],
          }),
        }) as unknown as Response;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('codex-flags-panel');

    setViewportHeight(480);
    const { transcript, updateMetrics } = installTranscriptHeightMock(harness, {
      controlsHeight: 460,
    });
    const height480 = transcript.getBoundingClientRect().height;

    expect(height480).toBeGreaterThanOrEqual(0);
    expect(transcript.style.overflowY).toBe('auto');

    setViewportHeight(700);
    updateMetrics();
    const height700 = transcript.getBoundingClientRect().height;
    expect(height700).toBeGreaterThan(height480);
    harness.restore();
  });

  it('ignores a late measurement callback for a removed row without crashing the transcript', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="chat"
        conversationId="chat-measurement"
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Measured response',
            createdAt: '2026-03-19T00:00:00.000Z',
          },
        ]}
        activeToolsAvailable={false}
        emptyMessage="Transcript will appear here once you send a message."
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
      '[data-transcript-row-id="assistant-1"]',
    );

    expect(row).toBeTruthy();
    row?.remove();

    expect(() => harness.triggerResize(row)).not.toThrow();
    expect(screen.getByTestId('chat-transcript')).toBeInTheDocument();

    harness.restore();
  });

  it('preserves reading position during row growth on the chat transcript path', async () => {
    const harness = installTranscriptMeasurementHarness();

    render(
      <SharedTranscript
        surface="chat"
        conversationId="chat-scroll-anchor"
        messages={[
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'First response',
            createdAt: '2026-03-19T00:00:00.000Z',
          },
          {
            id: 'assistant-2',
            role: 'assistant',
            content: 'Second response',
            createdAt: '2026-03-19T00:01:00.000Z',
          },
          {
            id: 'assistant-3',
            role: 'assistant',
            content: 'Third response',
            createdAt: '2026-03-19T00:02:00.000Z',
          },
        ]}
        activeToolsAvailable={false}
        emptyMessage="Transcript will appear here once you send a message."
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
      '[data-transcript-row-id="assistant-2"]',
    ) as HTMLElement | null;

    harness.setContainerMetrics(transcript, {
      width: 640,
      height: 320,
      clientHeight: 320,
      scrollHeight: 1000,
      scrollTop: 340,
    });

    transcript.scrollTop = 340;
    fireEvent.scroll(transcript);

    harness.setScrollMetrics(transcript, {
      scrollHeight: 1180,
      scrollTop: 340,
    });
    expect(row).not.toBeNull();
    harness.triggerResize(row);

    expect(transcript.scrollTop).toBe(520);
    harness.restore();
  });
});
