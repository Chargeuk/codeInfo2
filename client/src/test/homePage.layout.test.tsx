import type { LmStudioStatusOk } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetchServerVersion = jest
  .fn<() => Promise<{ version: string }>>()
  .mockResolvedValue({ version: '1.8.0' });
const mockFetchLmStudioStatus = jest.fn();
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
  models: [
    {
      modelKey: 'friendly-model',
      displayName: 'Friendly Model',
      type: 'gguf',
      format: 'gguf',
      sizeBytes: 1024,
    },
  ],
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
        selectedProvider: 'copilot',
        selectedModel: 'friendly-model',
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });
  global.fetch = fetchMock as typeof fetch;
}

describe('Home page layout', () => {
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

  it('renders through the shared utility shell with the expected utility sections', async () => {
    render(<HomePage />);

    expect(await screen.findByTestId('utility-page-shell')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-app-rail')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Versions')).toBeInTheDocument();
    expect(screen.getByText('Provider Status')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Provider readiness')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'LM Studio' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Friendly Model')).toBeInTheDocument();
  });
});
