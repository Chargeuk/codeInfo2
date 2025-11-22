import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import App from '../App';
import HomePage from '../pages/HomePage';
import LmStudioPage from '../pages/LmStudioPage';

jest.mock('@codeinfo2/common', () => ({
  ...jest.requireActual('@codeinfo2/common'),
  fetchServerVersion: jest.fn().mockResolvedValue({ version: '1.0.0' }),
}));

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'lmstudio', element: <LmStudioPage /> },
    ],
  },
];

describe('router navigation', () => {
  it('renders Home by default and navigates to LM Studio', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/Client version/i)).toBeInTheDocument();

    const lmTab = screen.getByRole('tab', { name: /LM Studio/i });
    await userEvent.click(lmTab);

    expect(router.state.location.pathname).toBe('/lmstudio');
    expect(
      await screen.findByRole('heading', { name: /LM Studio/i }),
    ).toBeInTheDocument();
  });
});
