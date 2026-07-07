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
const mockFetch = jest.fn<typeof fetch>();
beforeAll(() => {
  setScopedTestEnvValue('MODE', 'test');
  global.fetch = mockFetch;
});
beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as {
      __wsMock?: {
        reset: () => void;
      };
    }
  ).__wsMock?.reset();
});
const { default: App } = await import('../App');
const { default: FlowsPage } = await import('../pages/FlowsPage');
const { reconcileFlowDetailsCache } = await import('../pages/flowsPage.shared');
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
function mockJsonResponse(
  payload: unknown,
  init?: {
    status?: number;
  },
) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}
describe('Flows page run guards', () => {
  it('drops cached disabled flow details after a later list refresh marks the flow enabled', () => {
    const previousCache = {
      'daily::local': {
        name: 'daily',
        description: 'Daily flow',
        disabled: true,
        warnings: [
          {
            code: 'provider_unavailable',
            message: 'No usable provider remains',
          },
        ],
        disabledReason: {
          code: 'provider_unavailable',
          message: 'No usable provider remains',
        },
      },
    };
    const nextCache = reconcileFlowDetailsCache(previousCache, [
      { name: 'daily', description: 'Daily flow', disabled: false },
    ]);
    expect(nextCache).toEqual({});
    expect(nextCache).not.toBe(previousCache);
  });
  it('drops cached enabled flow details after a later list refresh marks the flow disabled', () => {
    const previousCache = {
      'daily::local': {
        name: 'daily',
        description: 'Daily flow',
        disabled: false,
        warnings: [],
      },
    };
    const nextCache = reconcileFlowDetailsCache(previousCache, [
      { name: 'daily', description: 'Daily flow', disabled: true },
    ]);
    expect(nextCache).toEqual({});
    expect(nextCache).not.toBe(previousCache);
  });
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
    expect(runRequests).toBe(0);
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/run')),
    ).toBe(false);
  });
  it('keeps a disabled summary flow unrunnable when the details payload omits disabled', async () => {
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
          },
        });
      }
      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'daily',
              description: 'Daily flow',
              disabled: true,
              error: 'No usable provider remains',
            },
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
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeDisabled());
    await act(async () => {
      await user.click(screen.getByTestId('flow-info'));
    });
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([url]) => {
          const target = String(url);
          return (
            target.includes('/flows/daily?') || target.endsWith('/flows/daily')
          );
        }),
      ).toBe(true),
    );
    await waitFor(() => expect(runButton).toBeDisabled());
    expect(runRequests).toBe(0);
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/run')),
    ).toBe(false);
  });
  it('keeps the active runnable selection when an ingested GitHub review variant is disabled from list data', async () => {
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
      if (target.includes('/flows/echo?') || target.endsWith('/flows/echo')) {
        return mockJsonResponse({
          flow: {
            name: 'echo',
            description: 'Echo flow',
            disabled: false,
            warnings: [],
          },
        });
      }
      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            { name: 'echo', description: 'Echo flow', disabled: false },
            {
              name: 'implement_next_plan_github_review',
              description: 'GitHub review cycle',
              disabled: true,
              sourceId: '/data/codeInfo2',
              sourceLabel: '/data/codeInfo2',
              error:
                'Flow agent "review_agent" is not available in the configured agent homes.',
            },
          ],
        });
      }
      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }
      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }
      if (target.includes('/flows/echo/run')) {
        runRequests += 1;
        return mockJsonResponse(
          {
            status: 'started',
            flowName: 'echo',
            conversationId: 'flow-1',
            inflightId: 'i1',
            modelId: 'gpt-5',
          },
          { status: 202 },
        );
      }
      if (target.includes('/flows/implement_next_plan_github_review/run')) {
        runRequests += 1;
        return mockJsonResponse(
          {
            error: 'AGENT_NOT_FOUND',
          },
          { status: 400 },
        );
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(screen.getByTestId('flow-select-trigger')).toHaveTextContent(
        'echo',
      ),
    );
    await user.click(screen.getByTestId('flow-select-trigger'));
    const disabledOption = await screen.findByTestId(
      'flow-option-implement_next_plan_github_review::/data/codeInfo2',
    );
    expect(disabledOption).toHaveAttribute('aria-disabled', 'true');
    const hiddenSelect = screen.getByTestId('flow-select') as HTMLSelectElement;
    const hiddenDisabledOption = hiddenSelect.querySelector(
      'option[value="implement_next_plan_github_review::/data/codeInfo2"]',
    );
    expect(hiddenDisabledOption).not.toBeNull();
    expect(hiddenDisabledOption).toBeDisabled();
    fireEvent.change(hiddenSelect, {
      target: {
        value: 'implement_next_plan_github_review::/data/codeInfo2',
      },
    });
    await expect(screen.getByTestId('flow-select-trigger')).toHaveTextContent(
      'echo',
    );
    await expect(hiddenSelect).toHaveValue('echo::local');
    await expect(screen.getByTestId('flow-run')).toBeEnabled();
    expect(runRequests).toBe(0);
  });
  it('revalidates selected flow details before starting a new run', async () => {
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
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await screen.findByText('No usable provider remains');
    await waitFor(() => expect(runButton).toBeDisabled());
    expect(runRequests).toBe(0);
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/run')),
    ).toBe(false);
  });
  it('revalidates selected flow details before resuming a flow', async () => {
    const user = userEvent.setup();
    let runRequests = 0;
    const now = new Date().toISOString();
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
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: { flow: { stepPath: [2, 0] } },
            },
          ],
        });
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
    const resumeButton = await screen.findByTestId('flow-resume');
    await waitFor(() => expect(resumeButton).toBeEnabled());
    await user.click(resumeButton);
    await screen.findByText('No usable provider remains');
    await waitFor(() => expect(resumeButton).toBeDisabled());
    expect(runRequests).toBe(0);
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/run')),
    ).toBe(false);
  });
  it('revalidates selected flow details before the visible composer send path resumes a flow', async () => {
    const user = userEvent.setup();
    let runRequests = 0;
    const now = new Date().toISOString();
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
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: { flow: { stepPath: [2, 0] } },
            },
          ],
        });
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
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await screen.findByText('No usable provider remains');
    await waitFor(() => expect(runButton).toBeDisabled());
    expect(runRequests).toBe(0);
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/run')),
    ).toBe(false);
  });
  it('releases the replay guard after a genuine rejected fresh run and clears stale retry ownership before the next launch', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    let runRequestCount = 0;
    const requestBodies: Record<string, unknown>[] = [];
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : 'url' in url && typeof url.url === 'string'
                ? url.url
                : url.toString();
        const method =
          init?.method ??
          (typeof url === 'object' &&
          url !== null &&
          'method' in url &&
          typeof url.method === 'string'
            ? url.method
            : undefined);
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (
          target.includes('/flows/daily?') ||
          target.endsWith('/flows/daily')
        ) {
          return mockJsonResponse({
            flow: {
              name: 'daily',
              description: 'Daily flow',
              disabled: false,
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
        if (
          target.includes('/conversations/') &&
          target.includes('/working-folder') &&
          method === 'POST'
        ) {
          return mockJsonResponse({
            status: 'ok',
            conversation: {
              conversationId: 'flow-resume-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              archived: false,
              flowName: 'daily',
              flags: {},
            },
          });
        }
        if (target.includes('/conversations')) {
          return mockJsonResponse({
            items: [
              {
                conversationId: 'flow-resume-1',
                title: 'Flow: daily',
                provider: 'codex',
                model: 'gpt-5',
                source: 'REST',
                lastMessageAt: now,
                archived: false,
                flowName: 'daily',
                flags: {
                  flow: {
                    stepPath: [2, 0],
                  },
                },
              },
            ],
          });
        }
        if (target.includes('/flows/daily/run')) {
          const body =
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {};
          requestBodies.push(body);
          runRequestCount += 1;
          if (runRequestCount === 1) {
            return mockJsonResponse(
              {
                code: 'FLOW_FAILED',
                message: 'Flow request failed',
              },
              { status: 500 },
            );
          }
          return mockJsonResponse(
            {
              status: 'started',
              flowName: 'daily',
              conversationId: 'flow-2',
              inflightId: 'i2',
              modelId: 'gpt-5',
            },
            { status: 202 },
          );
        }
        return mockJsonResponse({});
      },
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const titleInput = await screen.findByTestId('flow-custom-title');
    await user.type(titleInput, 'Should not leak');
    const [firstRow] = await screen.findAllByTestId('conversation-row');
    expect(firstRow).toBeTruthy();
    await user.click(firstRow);
    await waitFor(() => expect(titleInput).toBeDisabled());
    await user.click(screen.getByTestId('flow-new'));
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    expect(await screen.findByText('Flow request failed')).toBeInTheDocument();
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(screen.getByTestId('flow-new'));
    await user.click(runButton);
    await waitFor(() => expect(requestBodies).toHaveLength(2));
    expect(typeof requestBodies[0].retryOwnershipId).toBe('string');
    expect(requestBodies[0].retryOwnershipId).not.toBe('');
    expect(requestBodies[0]).not.toHaveProperty('customTitle');
    expect(requestBodies[0]).not.toHaveProperty('resumeStepPath');
    expect(requestBodies[1]).not.toHaveProperty('customTitle');
    expect(requestBodies[1]).not.toHaveProperty('resumeStepPath');
    expect(requestBodies[1].conversationId).not.toBe(
      requestBodies[0].conversationId,
    );
    expect(requestBodies[1].retryOwnershipId).not.toBe(
      requestBodies[0].retryOwnershipId,
    );
  });
  it('releases the replay guard after a validation-time detail-load failure so a later fresh run can proceed', async () => {
    const user = userEvent.setup();
    let failDetailsRequest = true;
    const requestBodies: Record<string, unknown>[] = [];
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
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
        if (
          target.includes('/flows/daily?') ||
          target.endsWith('/flows/daily')
        ) {
          if (failDetailsRequest) {
            failDetailsRequest = false;
            return mockJsonResponse(
              {
                code: 'DETAILS_UNAVAILABLE',
                message: 'Details service unavailable',
              },
              { status: 500 },
            );
          }
          return mockJsonResponse({
            flow: {
              name: 'daily',
              description: 'Daily flow',
              disabled: false,
              warnings: [],
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
          const body =
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {};
          requestBodies.push(body);
          return mockJsonResponse(
            {
              status: 'started',
              flowName: 'daily',
              conversationId: 'flow-1',
              inflightId: 'i1',
              providerId: 'provider-1',
              modelId: 'gpt-5',
            },
            { status: 202 },
          );
        }
        return mockJsonResponse({});
      },
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    expect(
      await screen.findByText('Details service unavailable'),
    ).toBeInTheDocument();
    expect(requestBodies).toHaveLength(0);
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => expect(requestBodies).toHaveLength(1));
    expect(requestBodies[0]).toHaveProperty('conversationId');
  });
  it('blocks a rapid fresh-run double-click on the first-arrival echo path even when the accepted launch settles and repopulates conversations before the barrier releases', async () => {
    const user = userEvent.setup();
    const requestBodies: Record<string, unknown>[] = [];
    const flowRows: Record<string, unknown>[] = [];
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      });
    try {
      mockFetch.mockImplementation(
        (url: RequestInfo | URL, init?: RequestInit) => {
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
          if (target.includes('/flows/echo') && !target.includes('/run')) {
            return mockJsonResponse({
              flow: {
                name: 'echo',
                description: 'Echo flow',
                disabled: false,
                warnings: [],
              },
            });
          }
          if (target.includes('/flows') && !target.includes('/run')) {
            return mockJsonResponse({
              flows: [
                { name: 'echo', description: 'Echo flow', disabled: false },
              ],
            });
          }
          if (target.includes('/conversations/') && target.includes('/turns')) {
            return mockJsonResponse({ items: [] });
          }
          if (target.includes('/conversations')) {
            return mockJsonResponse({
              items: flowRows,
              nextCursor: null,
            });
          }
          if (target.includes('/flows/echo/run')) {
            const body =
              typeof init?.body === 'string'
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : {};
            requestBodies.push(body);
            const runIndex = requestBodies.length;
            const conversationId = `fresh-flow-${runIndex}`;
            flowRows.unshift({
              conversationId,
              title: 'Flow: echo',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: new Date().toISOString(),
              archived: false,
              flowName: 'echo',
              flags: {},
            });
            return mockJsonResponse(
              {
                status: 'started',
                flowName: 'echo',
                conversationId,
                inflightId: `i${runIndex}`,
                providerId: 'codex',
                modelId: 'gpt-5',
              },
              { status: 202 },
            );
          }
          return mockJsonResponse({});
        },
      );
      const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
      render(<RouterProvider router={router} />);
      await waitFor(() =>
        expect(screen.getByTestId('flow-select')).toHaveValue('echo::local'),
      );
      await waitFor(() => expect(screen.getByTestId('flow-new')).toBeEnabled());
      await user.click(screen.getByTestId('flow-new'));
      const runButton = await screen.findByTestId('flow-run');
      await waitFor(() => expect(runButton).toBeEnabled());
      await act(async () => {
        fireEvent.click(runButton);
        fireEvent.click(runButton);
      });
      await waitFor(() => expect(requestBodies).toHaveLength(1));
      expect(requestBodies[0]).toHaveProperty('conversationId');
      await waitFor(() =>
        expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(
          'Flow: echo',
        ),
      );
      await waitFor(() => {
        const stopButton = screen.queryByTestId('flow-stop');
        if (stopButton) {
          expect(stopButton).toBeEnabled();
          return;
        }
        expect(runButton).toBeDisabled();
      });
      expect(requestBodies).toHaveLength(1);
      expect(flowRows).toHaveLength(1);
      await act(async () => {
        const callbacks = rafCallbacks.splice(0);
        callbacks.forEach((callback) => callback(performance.now()));
      });
      await waitFor(() => {
        const stopButton = screen.queryByTestId('flow-stop');
        if (stopButton) {
          expect(stopButton).toBeEnabled();
          return;
        }
        expect(runButton).toBeEnabled();
      });
    } finally {
      rafSpy.mockRestore();
    }
  });
});
