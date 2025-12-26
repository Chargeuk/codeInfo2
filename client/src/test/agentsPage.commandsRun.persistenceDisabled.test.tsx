import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
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

describe('Agents page - command execute disabled when persistence unavailable', () => {
  it('disables Execute and shows the persistence note when mongoConnected === false', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: false }),
        } as Response);
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'a1' }] }),
        } as Response);
      }

      if (target.includes('/agents/a1/commands')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            commands: [
              {
                name: 'improve_plan',
                description: 'd',
                disabled: false,
              },
            ],
          }),
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

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeDisabled());
    expect(
      await screen.findByTestId('agent-command-persistence-note'),
    ).toHaveTextContent('Commands require conversation history');
  });
});
