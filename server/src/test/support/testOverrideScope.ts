import { AsyncLocalStorage } from 'node:async_hooks';

import type { ChatProviderId } from '@codeinfo2/common';

type CodexDetectionOverride = {
  available: boolean;
  cliPath?: string;
  authPresent: boolean;
  configPresent: boolean;
  reason?: string;
};

type ProviderBootstrapStatusOverride = {
  healthy?: boolean;
  reason?: string;
  warnings?: string[];
};

type OverrideRecord = Record<string, unknown>;

type TestOverrideStore = {
  codexDetection?: CodexDetectionOverride;
  agentServiceDeps?: OverrideRecord;
  agentAvailabilityDeps?: OverrideRecord;
  flowServiceDeps?: OverrideRecord;
  envOverrides?: Record<string, string | undefined>;
  providerBootstrapStatuses?: Partial<
    Record<ChatProviderId, ProviderBootstrapStatusOverride>
  >;
};

type TestOverridePatch = {
  codexDetection?: CodexDetectionOverride | null;
  agentServiceDeps?: OverrideRecord | null;
  agentAvailabilityDeps?: OverrideRecord | null;
  flowServiceDeps?: OverrideRecord | null;
  envOverrides?: Record<string, string | undefined> | null;
  providerBootstrapStatuses?: Partial<
    Record<ChatProviderId, ProviderBootstrapStatusOverride | null>
  > | null;
};

const storage = new AsyncLocalStorage<TestOverrideStore>();

const mergeRecord = (
  current: OverrideRecord | undefined,
  patch: OverrideRecord | null | undefined,
): OverrideRecord | undefined => {
  if (patch === undefined) {
    return current;
  }
  if (patch === null) {
    return undefined;
  }
  return {
    ...(current ?? {}),
    ...patch,
  };
};

const mergeProviderBootstrapStatuses = (
  current:
    | Partial<Record<ChatProviderId, ProviderBootstrapStatusOverride>>
    | undefined,
  patch:
    | Partial<Record<ChatProviderId, ProviderBootstrapStatusOverride | null>>
    | null
    | undefined,
): Partial<Record<ChatProviderId, ProviderBootstrapStatusOverride>> | undefined => {
  if (patch === undefined) {
    return current;
  }
  if (patch === null) {
    return undefined;
  }

  const merged: Partial<Record<ChatProviderId, ProviderBootstrapStatusOverride>> =
    {
      ...(current ?? {}),
    };
  for (const [provider, status] of Object.entries(patch) as Array<
    [ChatProviderId, ProviderBootstrapStatusOverride | null]
  >) {
    if (status === null) {
      delete merged[provider];
      continue;
    }
    merged[provider] = {
      ...(merged[provider] ?? {}),
      ...status,
      ...(status.warnings ? { warnings: [...status.warnings] } : {}),
    };
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
};

const mergeStore = (
  current: TestOverrideStore | undefined,
  patch: TestOverridePatch,
): TestOverrideStore => ({
  codexDetection:
    patch.codexDetection === undefined
      ? current?.codexDetection
      : patch.codexDetection ?? undefined,
  agentServiceDeps: mergeRecord(current?.agentServiceDeps, patch.agentServiceDeps),
  agentAvailabilityDeps: mergeRecord(
    current?.agentAvailabilityDeps,
    patch.agentAvailabilityDeps,
  ),
  flowServiceDeps: mergeRecord(current?.flowServiceDeps, patch.flowServiceDeps),
  envOverrides:
    patch.envOverrides === undefined
      ? current?.envOverrides
      : patch.envOverrides === null
        ? undefined
        : {
            ...(current?.envOverrides ?? {}),
            ...patch.envOverrides,
          },
  providerBootstrapStatuses: mergeProviderBootstrapStatuses(
    current?.providerBootstrapStatuses,
    patch.providerBootstrapStatuses,
  ),
});

export function hasActiveTestOverrideScope(): boolean {
  return storage.getStore() !== undefined;
}

export function enterTestOverrideScope(patch: TestOverridePatch): void {
  storage.enterWith(mergeStore(storage.getStore(), patch));
}

export async function runWithTestOverrides<T>(
  patch: TestOverridePatch,
  fn: () => Promise<T>,
): Promise<T> {
  return await storage.run(mergeStore(storage.getStore(), patch), fn);
}

export function bindCurrentTestOverrides<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const snapshot = storage.getStore();
  if (!snapshot) {
    return fn;
  }
  return (...args: TArgs) => storage.run(snapshot, () => fn(...args));
}

export function getScopedCodexDetectionOverride():
  | CodexDetectionOverride
  | undefined {
  return storage.getStore()?.codexDetection;
}

export function getScopedAgentServiceDepsOverride():
  | OverrideRecord
  | undefined {
  return storage.getStore()?.agentServiceDeps;
}

export function getScopedAgentAvailabilityDepsOverride():
  | OverrideRecord
  | undefined {
  return storage.getStore()?.agentAvailabilityDeps;
}

export function getScopedFlowServiceDepsOverride():
  | OverrideRecord
  | undefined {
  return storage.getStore()?.flowServiceDeps;
}

export function getScopedEnvOverrides():
  | Record<string, string | undefined>
  | undefined {
  return storage.getStore()?.envOverrides;
}

export function getScopedEnvValue(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const scoped = storage.getStore()?.envOverrides;
  if (scoped && Object.prototype.hasOwnProperty.call(scoped, name)) {
    return scoped[name];
  }
  return env[name];
}

export function getScopedProcessEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const scoped = storage.getStore()?.envOverrides;
  if (!scoped) {
    return env;
  }
  return {
    ...env,
    ...scoped,
  };
}

export function getScopedProviderBootstrapStatusOverride(
  provider: ChatProviderId,
): ProviderBootstrapStatusOverride | undefined {
  return storage.getStore()?.providerBootstrapStatuses?.[provider];
}
