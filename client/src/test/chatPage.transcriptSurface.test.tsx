import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { setupChatWsHarness } from './support/mockChatWs';

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

describe('ChatPage transcript surface wrapper', () => {
  it('renders the transcript outside an outlined paper shell while keeping the composer below it', async () => {
    setupChatWsHarness({ mockFetch });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const transcript = await screen.findByTestId('chat-transcript');
    expect(transcript.closest('.MuiPaper-root')).toBeNull();
    expect(transcript.parentElement).not.toBeNull();
    const transcriptOverlay = transcript.parentElement!;
    const overlayStyles = getComputedStyle(transcriptOverlay);
    expect(overlayStyles.overflow).toBe('hidden');
    expect(overlayStyles.position).toBe('relative');
    expect(overlayStyles.display).toBe('flex');
    expect(screen.getByTestId('chat-controls')).toBeInTheDocument();
  });
});
