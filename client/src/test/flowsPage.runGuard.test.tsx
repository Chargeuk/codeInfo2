import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: FlowsPage } = await import('../pages/FlowsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'flows', element: <FlowsPage /> },
    ],
  },
];

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('Flows page run guards', () => {
  it('blocks new runs after the selected flow details surface marks the flow disabled', async () => {
    const user = userEvent.setup();
    let runRequests = 0;

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : 'url' in url && typeof url.url === 'string'
              ? url.url
              : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows/daily?') || target.endsWith('/flows/daily')) {
        return mockJsonResponse({
          flow: {
            name: 'daily',
            description: 'Daily flow',
            disabled: true,
            warnings: [
              {
                code: 'provider_unavailable',
                message: 'Primary provider unavailable',
              },
            ],
            disabledReason: {
              code: 'provider_unavailable',
              message: 'No usable provider remains',
            },
          },
        });
      }

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/flows/daily/run')) {
        runRequests += 1;
        return mockJsonResponse(
          {
            status: 'started',
            flowName: 'daily',
            conversationId: 'flow-1',
            inflightId: 'i1',
            modelId: 'gpt-5',
          },
          { status: 202 },
        );
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const workingFolderInput = await screen.findByTestId('flow-working-folder');
    await user.type(workingFolderInput, '/tmp/stale');

    await act(async () => {
      await user.click(screen.getByTestId('flow-info'));
    });

    await screen.findByText('No usable provider remains');

    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeDisabled());

    await user.click(runButton);

    expect(runRequests).toBe(0);
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/run')),
    ).toBe(false);
  });
});
