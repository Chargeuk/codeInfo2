import { LMStudioClient } from '@lmstudio/sdk';
import { createLmStudioTools } from '../lmstudio/tools.js';
import { ChatInterface } from './interfaces/ChatInterface.js';
import { ChatInterfaceCodex } from './interfaces/ChatInterfaceCodex.js';
import { ChatInterfaceLMStudio } from './interfaces/ChatInterfaceLMStudio.js';

export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported chat provider: ${provider}`);
    this.name = 'UnsupportedProviderError';
  }
}

type ProviderFactory = (deps?: {
  clientFactory?: (baseUrl: string) => LMStudioClient;
  toolFactory?: (opts: Record<string, unknown>) => {
    tools: ReadonlyArray<unknown>;
  };
}) => ChatInterface;

const defaultLmStudioClientFactory = (baseUrl: string) =>
  new LMStudioClient({ baseUrl });

const providerMap: Record<string, ProviderFactory> = {
  codex: () => new ChatInterfaceCodex(),
  lmstudio: (deps) =>
    new ChatInterfaceLMStudio(
      deps?.clientFactory ?? defaultLmStudioClientFactory,
      deps?.toolFactory ?? createLmStudioTools,
    ),
};

export function getChatInterface(
  provider: string,
  deps?: {
    clientFactory?: (baseUrl: string) => LMStudioClient;
    toolFactory?: (opts: Record<string, unknown>) => {
      tools: ReadonlyArray<unknown>;
    };
  },
): ChatInterface {
  const factory = providerMap[provider];
  if (!factory) {
    throw new UnsupportedProviderError(provider);
  }
  return factory(deps);
}
