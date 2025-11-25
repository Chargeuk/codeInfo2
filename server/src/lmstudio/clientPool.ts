import { LMStudioClient } from '@lmstudio/sdk';
import { baseLogger } from '../logger.js';

const clients = new Map<string, LMStudioClient>();
const defaultFactory = (baseUrl: string) => new LMStudioClient({ baseUrl });
let createClient: (baseUrl: string) => LMStudioClient = defaultFactory;

function disposeClient(client: LMStudioClient) {
  const asyncDispose = (
    client as { [Symbol.asyncDispose]?: () => Promise<void> }
  )[Symbol.asyncDispose];
  if (typeof asyncDispose === 'function') {
    return asyncDispose.call(client);
  }

  const close = (client as { close?: () => Promise<void> }).close;
  if (typeof close === 'function') {
    return close.call(client);
  }

  return Promise.resolve();
}

export function getClient(baseUrl: string): LMStudioClient {
  const existing = clients.get(baseUrl);
  if (existing) return existing;

  const client = createClient(baseUrl);
  clients.set(baseUrl, client);
  return client;
}

export async function closeAll(): Promise<void> {
  const entries = Array.from(clients.entries());
  clients.clear();

  await Promise.all(
    entries.map(async ([baseUrl, client]) => {
      try {
        await disposeClient(client);
      } catch (err) {
        baseLogger.warn({ err, baseUrl }, 'lmstudio client close failed');
      }
    }),
  );
}

// Test helper to reset the pool between scenarios without disposing clients twice.
export function resetPoolForTests(): void {
  clients.clear();
}

export function setClientFactoryForTests(
  factory: (baseUrl: string) => LMStudioClient,
): void {
  clients.clear();
  createClient = factory;
}

export function restoreDefaultClientFactory(): void {
  clients.clear();
  createClient = defaultFactory;
}
