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
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
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
        });
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
              { key: 'm1', displayName: 'Model 1', type: 'gguf' },
              {
                key: 'embed',
                displayName: 'Embedding Model',
                type: 'embedding',
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    });

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    expect(
      screen.getAllByText(/loading chat providers and models/i).length,
    ).toBeGreaterThan(0);

    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(select).toHaveTextContent('Model 1'));
    expect(screen.queryByText(/Embedding Model/i)).toBeNull();
  });

  it('surfaces an error alert when fetch fails', async () => {
    mockFetch.mockImplementation(() => {
      throw new Error('network down');
    });

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(select).toHaveTextContent('Mock Chat Model'));
  });
});
