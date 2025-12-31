import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
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

function installTranscriptHeightMock(options: {
  controlsHeight: number;
  minTranscriptHeight?: number;
}) {
  const transcript = screen.getByTestId('chat-transcript') as HTMLElement;
  const chatControls = screen.getByTestId('chat-controls') as HTMLElement;

  const layoutConfigured =
    transcript.style.flex === '1 1 0%' &&
    (transcript.style.minHeight === '0px' ||
      transcript.style.minHeight === '0') &&
    transcript.style.overflowY === 'auto' &&
    chatControls.style.flex === '0 0 auto';

  transcript.getBoundingClientRect = () => {
    const minTranscriptHeight = options.minTranscriptHeight ?? 0;
    const computedHeight = Math.max(
      minTranscriptHeight,
      window.innerHeight - options.controlsHeight,
    );

    const height = layoutConfigured ? computedHeight : 320;

    return {
      x: 0,
      y: 0,
      width: 640,
      height,
      top: 0,
      bottom: height,
      left: 0,
      right: 640,
      toJSON: () => ({}),
    } as DOMRect;
  };

  chatControls.getBoundingClientRect = () => {
    return {
      x: 0,
      y: 0,
      width: 640,
      height: options.controlsHeight,
      top: 0,
      bottom: options.controlsHeight,
      left: 0,
      right: 640,
      toJSON: () => ({}),
    } as DOMRect;
  };

  return { transcript };
}

describe('Chat transcript viewport height fill', () => {
  it('grows when the viewport height increases', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
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
            models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
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
    const { transcript } = installTranscriptHeightMock({ controlsHeight: 260 });
    const height700 = transcript.getBoundingClientRect().height;
    expect(height700).toBe(440);

    setViewportHeight(900);
    const height900 = transcript.getBoundingClientRect().height;
    expect(height900).toBe(640);

    expect(height900).toBeGreaterThan(height700);
  });

  it('keeps transcript height non-negative with tall controls (Codex flags expanded)', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
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
            models: [{ key: 'c1', displayName: 'Codex Model', type: 'codex' }],
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
    const { transcript } = installTranscriptHeightMock({ controlsHeight: 460 });
    const height480 = transcript.getBoundingClientRect().height;

    expect(height480).toBeGreaterThanOrEqual(0);
    expect(transcript.style.overflowY).toBe('auto');

    setViewportHeight(700);
    const height700 = transcript.getBoundingClientRect().height;
    expect(height700).toBeGreaterThan(height480);
  });
});
