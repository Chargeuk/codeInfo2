import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import useChatModel from '../hooks/useChatModel';
import { mockJsonResponse } from './support/fetchMock';

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const providers = {
  providers: [
    {
      id: 'codex',
      label: 'OpenAI Codex',
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
  selectedProvider: 'codex',
  selectedModel: 'server-default',
  selectedEndpointId: 'https://server.example/v1',
};

function mockCatalog(providerResponse: Response | Promise<Response>) {
  mockFetch.mockImplementation(async (input) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === '/chat/providers') return providerResponse;
    return mockJsonResponse({
      provider: url.searchParams.get('provider'),
      available: true,
      toolsAvailable: true,
      defaultModel: 'server-default',
      models: [
        { key: 'server-default', displayName: 'Default', type: 'gguf' },
        {
          key: 'shared',
          displayName: 'Shared endpoint',
          type: 'gguf',
          endpointId: 'https://alpha.example/v1',
        },
        { key: 'shared', displayName: 'Shared native', type: 'gguf' },
      ],
    });
  });
}

describe('useChatModel explicit selection bootstrap', () => {
  it.each([
    undefined,
    'https://alpha.example/v1',
    'https://missing.example/v1',
  ])(
    'preserves the explicit model and endpoint %s through bootstrap and refresh',
    async (endpointId) => {
      mockCatalog(mockJsonResponse(providers));
      const { result } = renderHook(() =>
        useChatModel({
          provider: 'lmstudio',
          model: 'shared',
          endpointId,
        }),
      );
      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(result.current.provider).toBe('lmstudio');
      expect(result.current.selected).toBe('shared');
      expect(result.current.selectedEndpointId).toBe(endpointId);
      await act(async () => {
        await result.current.refreshProviders();
      });
      await waitFor(() => expect(result.current.status).toBe('success'));
      await act(async () => {
        await result.current.refreshModels();
      });
      expect(result.current.provider).toBe('lmstudio');
      expect(result.current.selected).toBe('shared');
      expect(result.current.selectedEndpointId).toBe(endpointId);
    },
  );

  it('uses the provider default for a provider-only target instead of retaining another provider model with the same key', async () => {
    mockCatalog(mockJsonResponse(providers));
    const { result } = renderHook(() =>
      useChatModel({
        provider: 'lmstudio',
        model: 'shared',
        endpointId: 'https://alpha.example/v1',
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => {
      result.current.setProvider('codex', { source: 'url-select' });
      await result.current.refreshModels('codex');
    });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.provider).toBe('codex');
    expect(result.current.selected).toBe('server-default');
    expect(result.current.selectedEndpointId).toBeUndefined();
  });

  it('preserves saved metadata applied before provider bootstrap completes and a later URL selection', async () => {
    let resolveProviders!: (value: Response) => void;
    mockCatalog(
      new Promise<Response>((resolve) => {
        resolveProviders = resolve;
      }),
    );
    const { result } = renderHook(() => useChatModel());
    act(() => {
      result.current.setProvider('lmstudio', { source: 'conversation-select' });
      result.current.setSelected('saved-only', {
        source: 'conversation-select',
        endpointId: 'https://saved.example/v1',
      });
    });
    await act(async () => {
      resolveProviders(mockJsonResponse(providers));
    });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.provider).toBe('lmstudio');
    expect(result.current.selected).toBe('saved-only');
    expect(result.current.selectedEndpointId).toBe('https://saved.example/v1');
    act(() => {
      result.current.setProvider('codex', { source: 'url-select' });
      result.current.setSelected('shared', {
        source: 'url-select',
        endpointId: null,
      });
    });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.provider).toBe('codex');
    expect(result.current.selected).toBe('shared');
    expect(result.current.selectedEndpointId).toBeUndefined();
  });

  it('keeps an explicitly selected unavailable provider instead of choosing an available default', async () => {
    mockCatalog(
      mockJsonResponse({
        ...providers,
        providers: providers.providers.map((provider) => ({
          ...provider,
          available: provider.id === 'codex',
        })),
      }),
    );
    const { result } = renderHook(() =>
      useChatModel({
        provider: 'lmstudio',
        model: 'saved-only',
        endpointId: 'https://saved.example/v1',
      }),
    );
    await waitFor(() => expect(result.current.providerStatus).toBe('success'));
    expect(result.current.provider).toBe('lmstudio');
    expect(result.current.available).toBe(false);
    expect(result.current.selected).toBe('saved-only');
    expect(result.current.selectedEndpointId).toBe('https://saved.example/v1');
  });

  it('uses the existing server defaults when there is no explicit selection', async () => {
    mockCatalog(mockJsonResponse(providers));
    const { result } = renderHook(() => useChatModel());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.provider).toBe('codex');
    expect(result.current.selected).toBe('server-default');
    expect(result.current.selectedEndpointId).toBeUndefined();
  });
});
