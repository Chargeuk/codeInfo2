import {
  enterPersistentTestOverrideScope,
  enterTestOverrideScope,
  exitPersistentTestOverrideScope,
  getScopedEnvOverrides,
  getScopedEnvScopeState,
  hasPersistentTestOverrideScope,
} from './testOverrideScope.js';

type EnvOverlay = Record<string, string | undefined>;

type ProcessEnvIsolationState = {
  bootstrapEnvOverrides: EnvOverlay;
  hasEnteredTestScope: boolean;
  proxy: NodeJS.ProcessEnv;
  realEnv: NodeJS.ProcessEnv;
};

type BeginScopedTestEnvIsolationOptions = {
  persistentAcrossAsyncBoundaries?: boolean;
};

const PROCESS_ENV_ISOLATION_STATE = Symbol.for(
  'codeinfo2.test.processEnvIsolationState',
);

const hasOwn = (record: EnvOverlay, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

const normalizeEnvValue = (value: unknown): string => String(value);

const isNodeTestExecutionFrame = (): boolean => {
  const stack = new Error().stack ?? '';
  return (
    stack.includes('node:internal/test_runner/test') ||
    stack.includes('startSubtestAfterBootstrap') ||
    stack.includes('TestContext.<anonymous>') ||
    stack.includes('TestHook.run')
  );
};

const hasOpenScopedLayer = (): boolean => {
  const scopedLayer = getScopedLayer();
  const scopeState = getScopedEnvScopeState();
  return Boolean(scopedLayer && scopeState?.open);
};

const assertActiveScopedEnvWrite = (prop: string): void => {
  if (hasOpenScopedLayer()) {
    return;
  }
  if (isNodeTestExecutionFrame()) {
    beginScopedTestEnvIsolation({}, { persistentAcrossAsyncBoundaries: true });
    return;
  }
  throw new Error(
    `Scoped test env write attempted outside an active test scope for ${prop}`,
  );
};

const getStateHolder = () =>
  globalThis as typeof globalThis & {
    [PROCESS_ENV_ISOLATION_STATE]?: ProcessEnvIsolationState;
  };

const getScopedLayer = (): EnvOverlay | undefined => getScopedEnvOverrides();

const canWriteBootstrapEnv = (state: ProcessEnvIsolationState): boolean =>
  !state.hasEnteredTestScope && !hasOpenScopedLayer();

const resolveOverride = (
  state: ProcessEnvIsolationState,
  key: string,
): { found: boolean; value: string | undefined } => {
  const scoped = getScopedLayer();
  if (hasOpenScopedLayer() && scoped && hasOwn(scoped, key)) {
    return { found: true, value: scoped[key] };
  }
  if (hasOwn(state.bootstrapEnvOverrides, key)) {
    return { found: true, value: state.bootstrapEnvOverrides[key] };
  }
  return { found: false, value: undefined };
};

const getWritableLayer = (
  state: ProcessEnvIsolationState,
  options?: { requireActiveScope?: boolean },
): EnvOverlay => {
  const scopedLayer = getScopedLayer();
  if (scopedLayer && hasOpenScopedLayer()) {
    return scopedLayer;
  }
  if (canWriteBootstrapEnv(state)) {
    return state.bootstrapEnvOverrides;
  }
  if (options?.requireActiveScope) {
    throw new Error(
      'Scoped test env write attempted outside an active test scope.',
    );
  }
  return state.bootstrapEnvOverrides;
};

const collectVisibleKeys = (state: ProcessEnvIsolationState): Set<string> => {
  const keys = new Set<string>([
    ...Object.keys(state.realEnv),
    ...Object.keys(state.bootstrapEnvOverrides),
  ]);
  const scoped = getScopedLayer();
  if (hasOpenScopedLayer() && scoped) {
    for (const key of Object.keys(scoped)) {
      keys.add(key);
    }
  }
  return keys;
};

const applyEnvSnapshot = (
  state: ProcessEnvIsolationState,
  nextValue: Record<string, unknown> | NodeJS.ProcessEnv,
  options?: { requireActiveScope?: boolean },
) => {
  const layer = getWritableLayer(state, options);
  for (const key of Object.keys(layer)) {
    delete layer[key];
  }

  const nextEntries = Object.entries(nextValue ?? {});
  const nextKeys = new Set(nextEntries.map(([key]) => key));

  for (const key of collectVisibleKeys(state)) {
    if (!nextKeys.has(key)) {
      layer[key] = undefined;
    }
  }

  for (const [key, value] of nextEntries) {
    layer[key] = value === undefined ? undefined : normalizeEnvValue(value);
  }
};

export function installScopedProcessEnvProxy(): ProcessEnvIsolationState {
  const holder = getStateHolder();
  const existing = holder[PROCESS_ENV_ISOLATION_STATE];
  if (existing) {
    return existing;
  }

  const realEnv = process.env;
  const bootstrapEnvOverrides: EnvOverlay = {};

  const state: ProcessEnvIsolationState = {
    bootstrapEnvOverrides,
    hasEnteredTestScope: false,
    proxy: realEnv,
    realEnv,
  };

  const proxy = new Proxy(realEnv, {
    defineProperty(_target, prop, descriptor) {
      if (typeof prop !== 'string') {
        return Reflect.defineProperty(realEnv, prop, descriptor);
      }
      const layer = getWritableLayer(state, { requireActiveScope: true });
      layer[prop] =
        'value' in descriptor && descriptor.value !== undefined
          ? normalizeEnvValue(descriptor.value)
          : undefined;
      return true;
    },
    deleteProperty(_target, prop) {
      if (typeof prop !== 'string') {
        return Reflect.deleteProperty(realEnv, prop);
      }
      const layer = getWritableLayer(state, { requireActiveScope: true });
      layer[prop] = undefined;
      return true;
    },
    get(target, prop, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }
      const resolved = resolveOverride(state, prop);
      if (resolved.found) {
        return resolved.value;
      }
      return target[prop];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== 'string') {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
      const resolved = resolveOverride(state, prop);
      if (resolved.found) {
        if (resolved.value === undefined) {
          return undefined;
        }
        return {
          configurable: true,
          enumerable: true,
          value: resolved.value,
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    has(target, prop) {
      if (typeof prop !== 'string') {
        return Reflect.has(target, prop);
      }
      const resolved = resolveOverride(state, prop);
      if (resolved.found) {
        return resolved.value !== undefined;
      }
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      const keys = new Set<string | symbol>(
        Reflect.ownKeys(target).filter((key) => {
          if (typeof key !== 'string') {
            return true;
          }
          const resolved = resolveOverride(state, key);
          return !resolved.found || resolved.value !== undefined;
        }),
      );

      for (const key of Object.keys(state.bootstrapEnvOverrides)) {
        if (state.bootstrapEnvOverrides[key] !== undefined) {
          keys.add(key);
        }
      }

      const scoped = getScopedLayer();
      if (hasOpenScopedLayer() && scoped) {
        for (const key of Object.keys(scoped)) {
          if (scoped[key] !== undefined) {
            keys.add(key);
          } else {
            keys.delete(key);
          }
        }
      }

      return [...keys];
    },
    set(_target, prop, value) {
      if (typeof prop !== 'string') {
        return Reflect.set(realEnv, prop, value);
      }
      const layer = getWritableLayer(state, { requireActiveScope: true });
      layer[prop] = normalizeEnvValue(value);
      return true;
    },
  });

  state.proxy = proxy;
  holder[PROCESS_ENV_ISOLATION_STATE] = state;

  Object.defineProperty(process, 'env', {
    configurable: true,
    enumerable: true,
    get: () => proxy,
    set: (value: NodeJS.ProcessEnv) => {
      applyEnvSnapshot(state, value);
    },
  });

  return state;
}

export function beginScopedTestEnvIsolation(
  overrides: EnvOverlay = {},
  options?: BeginScopedTestEnvIsolationOptions,
): void {
  const state = getStateHolder()[PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Scoped process.env proxy is not installed.');
  }
  state.hasEnteredTestScope = true;
  const patch = {
    envOverrides: overrides,
    envScopeState: { open: true },
  };
  if (options?.persistentAcrossAsyncBoundaries) {
    enterPersistentTestOverrideScope(patch);
    return;
  }
  enterTestOverrideScope(patch);
}

export function endScopedTestEnvIsolation(
  options?: BeginScopedTestEnvIsolationOptions,
): void {
  const scopeState = getScopedEnvScopeState();
  if (scopeState) {
    scopeState.open = false;
  }
  if (
    options?.persistentAcrossAsyncBoundaries ||
    hasPersistentTestOverrideScope()
  ) {
    exitPersistentTestOverrideScope();
  }
}

export function setScopedTestEnvValue(name: string, value: unknown): void {
  assertActiveScopedEnvWrite(name);
  enterTestOverrideScope({
    envOverrides: { [name]: normalizeEnvValue(value) },
  });
}

export function clearScopedTestEnvValue(name: string): void {
  assertActiveScopedEnvWrite(name);
  enterTestOverrideScope({
    envOverrides: { [name]: undefined },
  });
}

export function setBootstrapTestEnvValue(name: string, value: unknown): void {
  const state = getStateHolder()[PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Scoped process.env proxy is not installed.');
  }
  state.bootstrapEnvOverrides[name] = normalizeEnvValue(value);
}

export function clearBootstrapTestEnvValue(name: string): void {
  const state = getStateHolder()[PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Scoped process.env proxy is not installed.');
  }
  state.bootstrapEnvOverrides[name] = undefined;
}

export function replaceScopedTestProcessEnv(
  nextValue: Record<string, unknown> | NodeJS.ProcessEnv,
): void {
  const state = getStateHolder()[PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Scoped process.env proxy is not installed.');
  }
  assertActiveScopedEnvWrite('process.env');
  applyEnvSnapshot(state, nextValue, { requireActiveScope: true });
}

export function installScopedTestEnvGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    clearBootstrapTestEnvValue?: typeof clearBootstrapTestEnvValue;
    clearScopedTestEnvValue?: typeof clearScopedTestEnvValue;
    replaceScopedTestProcessEnv?: typeof replaceScopedTestProcessEnv;
    setBootstrapTestEnvValue?: typeof setBootstrapTestEnvValue;
    setScopedTestEnvValue?: typeof setScopedTestEnvValue;
  };

  globals.setBootstrapTestEnvValue = setBootstrapTestEnvValue;
  globals.clearBootstrapTestEnvValue = clearBootstrapTestEnvValue;
  globals.setScopedTestEnvValue = setScopedTestEnvValue;
  globals.clearScopedTestEnvValue = clearScopedTestEnvValue;
  globals.replaceScopedTestProcessEnv = replaceScopedTestProcessEnv;
}

type SetBootstrapTestEnvValueFn = (name: string, value: unknown) => void;
type ClearBootstrapTestEnvValueFn = (name: string) => void;
type SetScopedTestEnvValueFn = (name: string, value: unknown) => void;
type ClearScopedTestEnvValueFn = (name: string) => void;
type ReplaceScopedTestProcessEnvFn = (
  nextValue: Record<string, unknown> | NodeJS.ProcessEnv,
) => void;

declare global {
  var setBootstrapTestEnvValue: SetBootstrapTestEnvValueFn;
  var clearBootstrapTestEnvValue: ClearBootstrapTestEnvValueFn;
  var setScopedTestEnvValue: SetScopedTestEnvValueFn;
  var clearScopedTestEnvValue: ClearScopedTestEnvValueFn;
  var replaceScopedTestProcessEnv: ReplaceScopedTestProcessEnvFn;
}
