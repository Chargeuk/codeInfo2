import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

const { default: App } = await import('../App');
const { default: AgentsPage } = await import('../pages/AgentsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agents', element: <AgentsPage /> },
    ],
  },
];

function mockAgentsListAndDetails() {
  let detailFetches = 0;

  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ mongoConnected: true }),
      } as Response);
    }

    if (
      target.includes('/agents/coding_agent') &&
      !target.includes('/commands')
    ) {
      detailFetches += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          agent: {
            name: 'coding_agent',
            description: '# Coding agent',
            disabled: true,
            warnings: [
              {
                code: 'invalid_provider',
                message:
                  'Agent config requested unsupported provider "not-a-provider".',
              },
            ],
            disabledReason: {
              code: 'provider_unavailable',
              message: 'No usable provider remains',
            },
            fallbackCandidates: [],
          },
        }),
      } as Response);
    }

    if (target.includes('/agents') && !target.includes('/commands')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          agents: [
            { name: 'coding_agent', warnings: ['duplicate root warning'] },
            { name: 'review_agent' },
          ],
        }),
      } as Response);
    }

    if (target.includes('/agents/') && target.includes('/commands')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ commands: [] }),
      } as Response);
    }

    if (target.includes('/conversations')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as Response);
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
  });

  return {
    getDetailFetches: () => detailFetches,
  };
}

describe('Agents page - list/details separation', () => {
  it('keeps the initial agent list stable while selected-agent details load on popover open', async () => {
    const user = userEvent.setup();
    const { getDetailFetches } = mockAgentsListAndDetails();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const select = await screen.findByRole('combobox', { name: /agent/i });
    await waitFor(() => expect(select).toHaveTextContent('coding_agent'));
    expect(getDetailFetches()).toBe(0);
    expect(
      screen.queryByText(/unsupported provider "not-a-provider"/i),
    ).toBeNull();

    await user.click(screen.getByTestId('agent-info'));

    const popover = await screen.findByTestId('agent-info-popover');
    expect(
      await within(popover).findByText(
        /unsupported provider "not-a-provider"/i,
      ),
    ).toBeInTheDocument();
    expect(
      await within(popover).findByText('No usable provider remains'),
    ).toBeVisible();
    expect(getDetailFetches()).toBe(1);
    expect(select).toHaveTextContent('coding_agent');

    await user.click(select);
    expect(
      await screen.findByRole('option', { name: 'coding_agent' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('option', { name: 'review_agent' }),
    ).toBeVisible();
  });
});
