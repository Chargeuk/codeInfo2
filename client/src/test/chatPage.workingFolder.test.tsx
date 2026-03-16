import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { setupChatWsHarness } from './support/mockChatWs';
import { mockJsonResponse } from './support/fetchMock';

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
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat', element: <ChatPage /> },
    ],
  },
];

function makeConversation(options?: { workingFolder?: string }) {
  return {
    conversationId: 'chat-1',
    title: 'Chat conversation',
    provider: 'lmstudio',
    model: 'm1',
    source: 'REST',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: false,
    flags: options?.workingFolder
      ? { workingFolder: options.workingFolder }
      : {},
  };
}

function renderChatWorkingFolderPage(options?: {
  conversations?: Array<Record<string, unknown>>;
}) {
  const workingFolderBodies: Array<Record<string, unknown>> = [];
  const harness = setupChatWsHarness({
    mockFetch,
    conversations: {
      items: options?.conversations ?? [makeConversation()],
      nextCursor: null,
    },
    turns: { items: [], nextCursor: null },
    fallbackFetch: (url, init) => {
      const href =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url instanceof Request
              ? url.url
              : 'url' in url && typeof url.url === 'string'
                ? url.url
                : url.toString();
      const method =
        init?.method ??
        (url instanceof Request
          ? url.method
          : typeof url === 'object' &&
              url !== null &&
              'method' in url &&
              typeof url.method === 'string'
            ? url.method
            : undefined);
      if (
        href.includes('/conversations/') &&
        href.includes('/working-folder') &&
        method === 'POST'
      ) {
        const body =
          typeof init.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        workingFolderBodies.push(body);
        const workingFolder =
          typeof body.workingFolder === 'string'
            ? body.workingFolder
            : undefined;
        return mockJsonResponse({
          status: 'ok',
          conversation: makeConversation({ workingFolder }),
        });
      }
      return mockJsonResponse({});
    },
  });

  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  return { ...harness, workingFolderBodies };
}

async function selectFirstConversation() {
  const rows = await screen.findAllByTestId('conversation-row');
  await userEvent.click(rows[0]);
  await waitFor(() =>
    expect(screen.getByTestId('chat-working-folder')).toBeInTheDocument(),
  );
}

describe('Chat page working folder', () => {
  it('restores the saved working folder from conversation state', async () => {
    renderChatWorkingFolderPage({
      conversations: [makeConversation({ workingFolder: '/repos/chat' })],
    });

    await selectFirstConversation();

    expect(await screen.findByTestId('chat-working-folder')).toHaveValue(
      '/repos/chat',
    );
  });

  it('saves an idle edit through the shared conversation helper', async () => {
    const { workingFolderBodies } = renderChatWorkingFolderPage();

    await selectFirstConversation();
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(''),
    );

    const input = await screen.findByTestId('chat-working-folder');
    fireEvent.change(input, { target: { value: '/repos/updated' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(workingFolderBodies).toContainEqual({
        workingFolder: '/repos/updated',
      }),
    );
  });

  it('shows the normal empty state when no saved working folder exists', async () => {
    renderChatWorkingFolderPage({ conversations: [makeConversation()] });

    await selectFirstConversation();

    expect(await screen.findByTestId('chat-working-folder')).toHaveValue('');
  });

  it('locks the picker while a local run is active', async () => {
    const user = userEvent.setup();
    renderChatWorkingFolderPage({
      conversations: [makeConversation({ workingFolder: '/repos/chat' })],
    });

    await selectFirstConversation();

    const message = await screen.findByTestId('chat-input');
    await user.type(message, 'Start run');
    await user.click(screen.getByTestId('chat-send'));

    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toBeDisabled(),
    );
  });

  it('locks the picker when websocket inflight state is present', async () => {
    const { emitInflightSnapshot } = renderChatWorkingFolderPage({
      conversations: [makeConversation({ workingFolder: '/repos/chat' })],
    });

    await selectFirstConversation();

    act(() => {
      emitInflightSnapshot({
        conversationId: 'chat-1',
        inflightId: 'inflight-1',
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toBeDisabled(),
    );
  });

  it('returns to the normal empty state after the server clears an invalid saved path', async () => {
    const { emitSidebarUpsert } = renderChatWorkingFolderPage({
      conversations: [makeConversation({ workingFolder: '/repos/chat' })],
    });

    await selectFirstConversation();
    expect(await screen.findByTestId('chat-working-folder')).toHaveValue(
      '/repos/chat',
    );

    act(() => {
      emitSidebarUpsert(makeConversation());
    });

    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(''),
    );
  });

  it('clears through the shared conversation helper and returns to the empty state', async () => {
    const { workingFolderBodies } = renderChatWorkingFolderPage({
      conversations: [makeConversation({ workingFolder: '/repos/chat' })],
    });

    await selectFirstConversation();
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(
        '/repos/chat',
      ),
    );

    const input = await screen.findByTestId('chat-working-folder');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(workingFolderBodies).toContainEqual({ workingFolder: null }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('chat-working-folder')).toHaveValue(''),
    );
  });
});
