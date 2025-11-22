import { jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
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

describe('Chat page models list', () => {
  it('shows loading then selects the first model', async () => {
    let resolveFetch:
      | ((value: {
          ok: boolean;
          status: number;
          json: () => Promise<unknown>;
        }) => void)
      | undefined;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    expect(screen.getAllByText(/loading models/i).length).toBeGreaterThan(0);

    await act(async () => {
      resolveFetch?.({
        ok: true,
        status: 200,
        json: async () => [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
      });
    });

    const select = await screen.findByRole('combobox', { name: /model/i });
    expect(select).toHaveTextContent('Model 1');
  });

  it('surfaces an error alert when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/network down/i);
  });
});
