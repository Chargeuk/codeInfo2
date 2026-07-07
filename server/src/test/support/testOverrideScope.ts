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

type EnvScopeState = {
  open: boolean;
};

type OverrideRecord = Record<string, unknown>;

type TestOverrideStore = {
  scopeId: number;
  revision: number;
  codexDetection?: CodexDetectionOverride;
  agentServiceDeps?: OverrideRecord;
  agentAvailabilityDeps?: OverrideRecord;
  flowServiceDeps?: OverrideRecord;
  envOverrides?: Record<string, string | undefined>;
  envScopeState?: EnvScopeState;
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
  envScopeState?: EnvScopeState | null;
  providerBootstrapStatuses?: Partial<
    Record<ChatProviderId, ProviderBootstrapStatusOverride | null>
  > | null;
};

const storage = new AsyncLocalStorage<TestOverrideStore>();
const scopeIdStorage = new AsyncLocalStorage<number>();
const persistentStores = new Map<number, TestOverrideStore>();
let nextStoreRevision = 0;
let nextScopeId = 0;

const allocateStoreRevision = (): number => {
  nextStoreRevision += 1;
  return nextStoreRevision;
};

const allocateScopeId = (): number => {
  nextScopeId += 1;
  return nextScopeId;
};

const getCurrentScopeId = (): number | undefined =>
  storage.getStore()?.scopeId ?? scopeIdStorage.getStore();

export function getCurrentTestOverrideScopeId(): number | undefined {
  return getCurrentScopeId();
}

const getPersistentStoreForCurrentScope = (): TestOverrideStore | undefined => {
  const scopeId = getCurrentScopeId();
  if (scopeId === undefined) {
    return undefined;
  }
  return persistentStores.get(scopeId);
};

const getCurrentStore = (): TestOverrideStore | undefined => {
  const scopedStore = storage.getStore();
  const persistentStore = getPersistentStoreForCurrentScope();
  if (persistentStore && scopedStore) {
    return persistentStore.revision > scopedStore.revision
      ? persistentStore
      : scopedStore;
  }
  return scopedStore ?? persistentStore;
};

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

const buildPatchedStore = (
  current: TestOverrideStore | undefined,
  patch: TestOverridePatch,
  options?: { newScope?: boolean },
): TestOverrideStore => ({
  scopeId: options?.newScope
    ? allocateScopeId()
    : current?.scopeId ?? getCurrentScopeId() ?? allocateScopeId(),
  revision: allocateStoreRevision(),
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
  envScopeState:
    patch.envScopeState === undefined
      ? current?.envScopeState
      : patch.envScopeState ?? undefined,
  providerBootstrapStatuses: mergeProviderBootstrapStatuses(
    current?.providerBootstrapStatuses,
    patch.providerBootstrapStatuses,
  ),
});

export function hasActiveTestOverrideScope(): boolean {
  return getCurrentStore() !== undefined;
}

export function hasPersistentTestOverrideScope(): boolean {
  return getPersistentStoreForCurrentScope() !== undefined;
}

export function enterTestOverrideScope(patch: TestOverridePatch): void {
  const merged = buildPatchedStore(getCurrentStore(), patch);
  if (persistentStores.has(merged.scopeId)) {
    persistentStores.set(merged.scopeId, merged);
  }
  scopeIdStorage.enterWith(merged.scopeId);
  storage.enterWith(merged);
}

export function enterPersistentTestOverrideScope(
  patch: TestOverridePatch,
): void {
  const merged = buildPatchedStore(getCurrentStore(), patch, { newScope: true });
  persistentStores.set(merged.scopeId, merged);
  scopeIdStorage.enterWith(merged.scopeId);
  storage.enterWith(merged);
}

export function exitPersistentTestOverrideScope(): void {
  const scopeId = getCurrentScopeId();
  if (scopeId !== undefined) {
    persistentStores.delete(scopeId);
  }
}

export async function runWithTestOverrides<T>(
  patch: TestOverridePatch,
  fn: () => Promise<T>,
): Promise<T> {
  const merged = buildPatchedStore(getCurrentStore(), patch);
  return await scopeIdStorage.run(merged.scopeId, () => storage.run(merged, fn));
}

export function bindCurrentTestOverrides<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const snapshot = getCurrentStore();
  if (!snapshot) {
    return fn;
  }
  return (...args: TArgs) =>
    scopeIdStorage.run(snapshot.scopeId, () => storage.run(snapshot, () => fn(...args)));
}

export function getScopedCodexDetectionOverride():
  | CodexDetectionOverride
  | undefined {
  return getCurrentStore()?.codexDetection;
}

export function getScopedAgentServiceDepsOverride():
  | OverrideRecord
  | undefined {
  return getCurrentStore()?.agentServiceDeps;
}

export function getScopedAgentAvailabilityDepsOverride():
  | OverrideRecord
  | undefined {
  return getCurrentStore()?.agentAvailabilityDeps;
}

export function getScopedFlowServiceDepsOverride():
  | OverrideRecord
  | undefined {
  return getCurrentStore()?.flowServiceDeps;
}

export function getScopedEnvOverrides():
  | Record<string, string | undefined>
  | undefined {
  return getCurrentStore()?.envOverrides;
}

export function getScopedEnvScopeState(): EnvScopeState | undefined {
  return getCurrentStore()?.envScopeState;
}

export function getScopedEnvValue(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const scoped = getCurrentStore()?.envOverrides;
  if (scoped && Object.prototype.hasOwnProperty.call(scoped, name)) {
    return scoped[name];
  }
  return env[name];
}

export function getScopedProcessEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const scoped = getCurrentStore()?.envOverrides;
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
  return getCurrentStore()?.providerBootstrapStatuses?.[provider];
}
