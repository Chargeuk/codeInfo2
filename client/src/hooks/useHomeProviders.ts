import type {
  ChatProviderInfo,
  ChatProvidersResponse,
} from '@codeinfo2/common';
import { useCallback, useEffect, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';

type HomeProvidersState = {
  providers: ChatProviderInfo[];
  selectedProvider?: ChatProvidersResponse['selectedProvider'];
  selectedModel?: ChatProvidersResponse['selectedModel'];
  fallbackApplied?: boolean;
  loading: boolean;
  error: string | null;
  refreshProviders: () => Promise<void>;
};

const serverBase = getApiBaseUrl();

export function useHomeProviders(): HomeProvidersState {
  const [providers, setProviders] = useState<ChatProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] =
    useState<ChatProvidersResponse['selectedProvider']>();
  const [selectedModel, setSelectedModel] =
    useState<ChatProvidersResponse['selectedModel']>();
  const [fallbackApplied, setFallbackApplied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        new URL('/chat/providers', serverBase).toString(),
      );
      if (!res.ok) {
        throw new Error(`chat providers failed: ${res.status}`);
      }

      const body = (await res.json()) as ChatProvidersResponse;
      if (!Array.isArray(body.providers)) {
        throw new Error('Malformed chat providers response');
      }

      setProviders(body.providers);
      setSelectedProvider(body.selectedProvider);
      setSelectedModel(body.selectedModel);
      setFallbackApplied(Boolean(body.fallbackApplied));
    } catch (err) {
      setProviders([]);
      setSelectedProvider(undefined);
      setSelectedModel(undefined);
      setFallbackApplied(false);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  return {
    providers,
    selectedProvider,
    selectedModel,
    fallbackApplied,
    loading,
    error,
    refreshProviders,
  };
}

export default useHomeProviders;
