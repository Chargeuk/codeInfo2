import type { LmStudioStatusOk } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetchServerVersion = jest
  .fn<() => Promise<{ version: string }>>()
  .mockResolvedValue({ version: '1.8.0' });
const mockFetchLmStudioStatus = jest.fn<() => Promise<LmStudioStatusOk>>();
const actualCommon = await import('@codeinfo2/common');

await jest.unstable_mockModule('@codeinfo2/common', async () => ({
  ...actualCommon,
  fetchServerVersion: mockFetchServerVersion,
  fetchLmStudioStatus: mockFetchLmStudioStatus,
}));

const { default: HomePage } = await import('../pages/HomePage');

const okResponse: LmStudioStatusOk = {
  status: 'ok',
  baseUrl: 'http://127.0.0.1:1234',
  models: [],
};

function installProviderFetch() {
  const fetchMock = getFetchMock();
  fetchMock.mockImplementation(async (input) => {
    const href = typeof input === 'string' ? input : input.toString();
    if (href.includes('/chat/providers')) {
      return mockJsonResponse({
        providers: [
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: false,
            toolsAvailable: false,
            reason: 'codex auth required',
          },
          {
            id: 'copilot',
            label: 'GitHub Copilot',
            available: true,
            toolsAvailable: true,
          },
          {
            id: 'lmstudio',
            label: 'LM Studio',
            available: true,
            toolsAvailable: true,
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });
  global.fetch = fetchMock as typeof fetch;
}

function installBrokenProviderFetch(mode: 'network' | 'schema') {
  const fetchMock = getFetchMock();
  fetchMock.mockImplementation(async (input) => {
    const href = typeof input === 'string' ? input : input.toString();
    if (href.includes('/chat/providers')) {
      if (mode === 'network') {
        throw new Error('provider discovery offline');
      }
      return mockJsonResponse({ providers: 'invalid' });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });
  global.fetch = fetchMock as typeof fetch;
}

describe('Home page status', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetchServerVersion.mockClear();
    mockFetchLmStudioStatus.mockReset();
    localStorage.clear();
    installProviderFetch();
    mockFetchLmStudioStatus.mockResolvedValue(okResponse);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows conservative provider wording and reuses the shared auth dialog', async () => {
    render(<HomePage />);

    expect(
      (await screen.findAllByText('codex auth required')).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText('No login required')).length,
    ).toBeGreaterThan(0);

    await userEvent.click(
      screen.getAllByRole('button', { name: /provider auth/i })[0],
    );

    expect(
      await screen.findByRole('heading', { name: 'Choose Authentication' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Codex Auth')).toBeInTheDocument();
    expect(screen.getByText('Copilot Auth')).toBeInTheDocument();
  });

  it.each([
    ['network', 'provider discovery offline'],
    ['schema', 'Malformed chat providers response'],
  ] as const)(
    'shows a provider readiness warning when provider discovery has a %s failure',
    async (mode, expectedMessage) => {
      installBrokenProviderFetch(mode);

      render(<HomePage />);

      expect(
        await screen.findByTestId('home-provider-status-error'),
      ).toHaveTextContent(`Provider readiness unavailable: ${expectedMessage}`);
    },
  );
});
