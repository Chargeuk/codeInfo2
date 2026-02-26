import { jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import useIngestModels from '../hooks/useIngestModels';

const mockFetch = global.fetch as jest.Mock;

function mockModelsResponse(payload: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

describe('useIngestModels', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('prefers canonical lock fields and falls back to aliases', async () => {
    mockModelsResponse({
      models: [{ id: 'm-openai', displayName: 'OpenAI', provider: 'openai' }],
      lock: {
        embeddingProvider: 'openai',
        embeddingModel: 'm-openai',
        embeddingDimensions: 1536,
        lockedModelId: 'legacy-lock',
      },
      lockedModelId: 'legacy-lock',
      openai: { enabled: true, status: 'ok', statusCode: 'OPENAI_OK' },
    });

    const first = renderHook(() => useIngestModels());

    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(first.result.current.lockedModelId).toBe('m-openai');
    expect(first.result.current.lockedModel.embeddingProvider).toBe('openai');
    expect(first.result.current.lockedModel.embeddingModel).toBe('m-openai');

    first.unmount();

    mockModelsResponse({
      models: [{ id: 'legacy-model', displayName: 'Legacy LM' }],
      lockedModelId: 'legacy-model',
      openai: {
        enabled: false,
        status: 'disabled',
        statusCode: 'OPENAI_DISABLED',
      },
    });

    const second = renderHook(() => useIngestModels());
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));

    expect(second.result.current.lockedModelId).toBe('legacy-model');
    expect(second.result.current.lockedModel.embeddingProvider).toBe(
      'lmstudio',
    );
    expect(second.result.current.lockedModel.embeddingModel).toBe(
      'legacy-model',
    );
  });

  it('parses normalized warning envelopes and legacy string messages safely', async () => {
    mockModelsResponse({
      models: [{ id: 'lm-a', displayName: 'LM A', provider: 'lmstudio' }],
      openai: {
        enabled: true,
        status: 'warning',
        statusCode: 'OPENAI_MODELS_LIST_UNAVAILABLE',
        message: 'OpenAI unavailable',
        warning: {
          code: 'OPENAI_MODELS_LIST_UNAVAILABLE',
          message: 'Upstream unavailable',
          retryable: false,
        },
      },
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.openai?.message).toBe('OpenAI unavailable');
    expect(result.current.openai?.warning?.message).toBe(
      'Upstream unavailable',
    );
    expect(result.current.isError).toBe(false);
    expect(result.current.models).toHaveLength(1);
  });

  it('parses disabled OpenAI status envelope', async () => {
    mockModelsResponse({
      models: [{ id: 'lm-a', displayName: 'LM A', provider: 'lmstudio' }],
      openai: {
        enabled: false,
        status: 'disabled',
        statusCode: 'OPENAI_DISABLED',
      },
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.openai?.enabled).toBe(false);
    expect(result.current.openai?.status).toBe('disabled');
    expect(result.current.openai?.statusCode).toBe('OPENAI_DISABLED');
    expect(result.current.openai?.warning).toBeUndefined();
  });

  it('parses ok OpenAI status envelope', async () => {
    mockModelsResponse({
      models: [
        { id: 'lm-a', displayName: 'LM A', provider: 'lmstudio' },
        {
          id: 'text-embedding-3-small',
          displayName: 'text-embedding-3-small',
          provider: 'openai',
        },
      ],
      openai: { enabled: true, status: 'ok', statusCode: 'OPENAI_OK' },
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const openAiModel = result.current.models.find(
      (m) => m.provider === 'openai',
    );
    expect(result.current.openai?.status).toBe('ok');
    expect(openAiModel?.id).toBe('text-embedding-3-small');
    expect(result.current.openai?.warning).toBeUndefined();
  });

  it('parses temporary-failure warning envelope', async () => {
    mockModelsResponse({
      models: [{ id: 'lm-a', displayName: 'LM A', provider: 'lmstudio' }],
      openai: {
        enabled: true,
        status: 'warning',
        statusCode: 'OPENAI_MODELS_LIST_TEMPORARY_FAILURE',
        warning: {
          code: 'OPENAI_MODELS_LIST_TEMPORARY_FAILURE',
          message: 'Temporary issue',
          retryable: true,
          retryAfterMs: 750,
        },
      },
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.openai?.statusCode).toBe(
      'OPENAI_MODELS_LIST_TEMPORARY_FAILURE',
    );
    expect(result.current.openai?.warning?.retryable).toBe(true);
    expect(result.current.models.some((m) => m.provider === 'lmstudio')).toBe(
      true,
    );
  });

  it('parses auth-failed warning envelope', async () => {
    mockModelsResponse({
      models: [{ id: 'lm-a', displayName: 'LM A', provider: 'lmstudio' }],
      openai: {
        enabled: true,
        status: 'warning',
        statusCode: 'OPENAI_MODELS_LIST_AUTH_FAILED',
        warning: {
          code: 'OPENAI_MODELS_LIST_AUTH_FAILED',
          message: 'Auth failed',
          retryable: false,
        },
      },
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.openai?.statusCode).toBe(
      'OPENAI_MODELS_LIST_AUTH_FAILED',
    );
    expect(result.current.openai?.status).toBe('warning');
  });

  it('parses unavailable warning envelope', async () => {
    mockModelsResponse({
      models: [{ id: 'lm-a', displayName: 'LM A', provider: 'lmstudio' }],
      openai: {
        enabled: true,
        status: 'warning',
        statusCode: 'OPENAI_MODELS_LIST_UNAVAILABLE',
        warning: {
          code: 'OPENAI_MODELS_LIST_UNAVAILABLE',
          message: 'Unavailable',
          retryable: false,
        },
      },
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.openai?.statusCode).toBe(
      'OPENAI_MODELS_LIST_UNAVAILABLE',
    );
    expect(result.current.isError).toBe(false);
  });

  it('parses allowlist-no-match warning envelope', async () => {
    mockModelsResponse({
      models: [{ id: 'lm-a', displayName: 'LM A', provider: 'lmstudio' }],
      openai: {
        enabled: true,
        status: 'warning',
        statusCode: 'OPENAI_ALLOWLIST_NO_MATCH',
        warning: {
          code: 'OPENAI_ALLOWLIST_NO_MATCH',
          message: 'No supported OpenAI models',
          retryable: false,
        },
      },
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.openai?.statusCode).toBe('OPENAI_ALLOWLIST_NO_MATCH');
    expect(result.current.openai?.warning?.retryable).toBe(false);
    expect(result.current.models.some((m) => m.provider === 'openai')).toBe(
      false,
    );
  });

  it('handles missing or partial provider envelopes without throw', async () => {
    mockModelsResponse({
      models: [
        { id: 'lm-a', displayName: 'LM A' },
        {
          id: 'text-embedding-3-small',
          displayName: 'OpenAI model',
          provider: 'openai',
        },
      ],
      openai: {
        status: 'warning',
      },
      lmstudio: {},
    });

    const { result } = renderHook(() => useIngestModels());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isError).toBe(false);
    expect(result.current.models).toHaveLength(2);
    expect(result.current.models[0]?.provider).toBe('lmstudio');
    expect(result.current.openai?.status).toBe('warning');
  });
});
