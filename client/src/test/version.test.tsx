import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import App from '../App';
import HomePage from '../pages/HomePage';
import LmStudioPage from '../pages/LmStudioPage';

jest.mock('@codeinfo2/common', () => {
  const actual = jest.requireActual(
    '@codeinfo2/common',
  ) as typeof import('@codeinfo2/common');
  return {
    ...actual,
    fetchServerVersion: jest
      .fn<typeof actual.fetchServerVersion>()
      .mockResolvedValue({ app: 'server', version: '0.0.1' }),
  };
});

describe('App version display', () => {
  const originalRuntimeConfig = (
    globalThis as typeof globalThis & {
      __CODEINFO_CONFIG__?: unknown;
    }
  ).__CODEINFO_CONFIG__;

  afterEach(() => {
    (
      globalThis as typeof globalThis & { __CODEINFO_CONFIG__?: unknown }
    ).__CODEINFO_CONFIG__ = originalRuntimeConfig;
  });

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

  it('surfaces an invalid api base url banner when the explicit runtime directive is malformed', async () => {
    (
      globalThis as typeof globalThis & {
        __CODEINFO_CONFIG__?: { apiBaseUrl?: string };
      }
    ).__CODEINFO_CONFIG__ = { apiBaseUrl: 'USE_BROWSER_HOST:not-a-port' };

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

    expect(
      await screen.findByTestId('runtime-config-api-base-url-banner'),
    ).toHaveTextContent('Invalid apiBaseUrl directive');
    expect(screen.getByText(/CodeInfo2 Versions/i)).toBeInTheDocument();
  });
});
