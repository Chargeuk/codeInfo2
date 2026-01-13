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

describe('Chat tool details rendering (WS transcript events)', () => {
  it('renders vector search tool file list', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Search' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
    });
    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-request',
        callId: 't1',
        name: 'VectorSearch',
        parameters: { query: 'hello', limit: 5 },
      },
    });
    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 't1',
        name: 'VectorSearch',
        stage: 'success',
        parameters: { query: 'hello', limit: 5 },
        result: {
          files: [
            {
              hostPath: '/repo/a.txt',
              highestMatch: 0.82,
              chunkCount: 3,
              lineCount: 20,
            },
          ],
          results: [
            {
              repo: 'repo-one',
              relPath: 'src/a.ts',
              hostPath: '/repo/a.txt',
              score: 0.12,
              chunk: 'const value = 1;',
            },
          ],
          modelId: 'm1',
        },
      },
    });
    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Answer',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    const toolToggle = await screen.findByTestId('tool-toggle');
    await user.click(toolToggle);

    const files = await screen.findAllByTestId('tool-file-item');
    expect(files.length).toBeGreaterThan(0);
    expect(files[0].textContent ?? '').toContain('/repo/a.txt');

    const matches = await screen.findAllByTestId('tool-match-item');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].textContent ?? '').toContain('Distance');
    expect(matches[0].textContent ?? '').toContain('0.120');
  });

  it('renders trimmed tool errors', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Error' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
    });
    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-request',
        callId: 't2',
        name: 'VectorSearch',
        parameters: { query: 'oops' },
      },
    });
    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 't2',
        name: 'VectorSearch',
        stage: 'error',
        parameters: { query: 'oops' },
        errorTrimmed: { code: 'MODEL_UNAVAILABLE', message: 'missing model' },
        errorFull: {
          code: 'MODEL_UNAVAILABLE',
          message: 'missing model',
          stack: 'trace',
        },
      },
    });

    const toolToggle = await screen.findByTestId('tool-toggle');
    await user.click(toolToggle);

    const trimmed = await screen.findByTestId('tool-error-trimmed');
    expect(trimmed.textContent ?? '').toContain('missing model');
  });

  it('renders placeholders when distance or preview is missing', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Search' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
    });
    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-request',
        callId: 't3',
        name: 'VectorSearch',
        parameters: { query: 'hello', limit: 5 },
      },
    });
    harness.emitToolEvent({
      conversationId: conversationId!,
      inflightId,
      event: {
        type: 'tool-result',
        callId: 't3',
        name: 'VectorSearch',
        stage: 'success',
        parameters: { query: 'hello', limit: 5 },
        result: {
          files: [],
          results: [{ repo: 'repo-one', relPath: 'src/a.ts' }],
          modelId: 'm1',
        },
      },
    });
    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Answer',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    const toolToggle = await screen.findByTestId('tool-toggle');
    await user.click(toolToggle);

    const matches = await screen.findAllByTestId('tool-match-item');
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent ?? '').toContain('Distance: —');
    expect(matches[0].textContent ?? '').toContain('Preview: —');
  });
});
