import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import App from '../App';
import HomePage from '../pages/HomePage';
import LmStudioPage from '../pages/LmStudioPage';

jest.mock('@codeinfo2/common', () => ({
  ...jest.requireActual('@codeinfo2/common'),
  fetchServerVersion: jest
    .fn()
    .mockResolvedValue({ app: 'server', version: '0.0.1' }),
}));

describe('App version display', () => {
  it('shows client and server versions', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <App />,
          children: [
            { index: true, element: <HomePage /> },
            { path: 'lmstudio', element: <LmStudioPage /> },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(/Client version/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Server version/i)).toBeInTheDocument(),
    );
  });
});
