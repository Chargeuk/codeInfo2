type EnvOverlay = Record<string, string | undefined>;

type ClientProcessEnvIsolationState = {
  bootstrapEnvOverrides: EnvOverlay;
  currentTestEnvOverrides: EnvOverlay | null;
  currentTestEnvScopeState: { open: boolean } | null;
  proxy: NodeJS.ProcessEnv;
  realEnv: NodeJS.ProcessEnv;
};

const CLIENT_PROCESS_ENV_ISOLATION_STATE = Symbol.for(
  'codeinfo2.clientTest.processEnvIsolationState',
);

const hasOwn = (record: EnvOverlay, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

const normalizeEnvValue = (value: unknown): string => String(value);

const assertActiveScopedEnvWrite = (
  state: ClientProcessEnvIsolationState,
  prop: string,
): void => {
  if (state.currentTestEnvOverrides && state.currentTestEnvScopeState?.open) {
    return;
  }

  throw new Error(
    `Scoped test env write attempted outside an active test scope for ${prop}`,
  );
};

const getStateHolder = () =>
  globalThis as typeof globalThis & {
    [CLIENT_PROCESS_ENV_ISOLATION_STATE]?: ClientProcessEnvIsolationState;
  };

const getScopedLayer = (state: ClientProcessEnvIsolationState) =>
  state.currentTestEnvOverrides;

const resolveOverride = (
  state: ClientProcessEnvIsolationState,
  key: string,
): { found: boolean; value: string | undefined } => {
  const scoped = getScopedLayer(state);
  if (scoped && hasOwn(scoped, key)) {
    return { found: true, value: scoped[key] };
  }
  if (hasOwn(state.bootstrapEnvOverrides, key)) {
    return { found: true, value: state.bootstrapEnvOverrides[key] };
  }
  return { found: false, value: undefined };
};

const getWritableLayer = (
  state: ClientProcessEnvIsolationState,
): EnvOverlay => {
  const scopedLayer = getScopedLayer(state);
  if (scopedLayer && state.currentTestEnvScopeState?.open) {
    return scopedLayer;
  }
  return state.bootstrapEnvOverrides;
};

const getScopedWritableLayer = (
  state: ClientProcessEnvIsolationState,
): EnvOverlay => {
  const scopedLayer = getScopedLayer(state);
  if (!scopedLayer || !state.currentTestEnvScopeState?.open) {
    throw new Error(
      'Scoped test env write attempted outside an active test scope.',
    );
  }
  return scopedLayer;
};

const collectVisibleKeys = (
  state: ClientProcessEnvIsolationState,
): Set<string> => {
  const keys = new Set<string>([
    ...Object.keys(state.realEnv),
    ...Object.keys(state.bootstrapEnvOverrides),
  ]);
  const scoped = getScopedLayer(state);
  if (scoped) {
    for (const key of Object.keys(scoped)) {
      keys.add(key);
    }
  }
  return keys;
};

const applyEnvSnapshot = (
  state: ClientProcessEnvIsolationState,
  nextValue: Record<string, unknown> | NodeJS.ProcessEnv,
) => {
  assertActiveScopedEnvWrite(state, 'process.env');
  const layer = getScopedWritableLayer(state);
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

export function installClientTestProcessEnvIsolation(): void {
  const holder = getStateHolder();
  if (holder[CLIENT_PROCESS_ENV_ISOLATION_STATE]) {
    return;
  }

  const realEnv = process.env;
  const state: ClientProcessEnvIsolationState = {
    bootstrapEnvOverrides: {},
    currentTestEnvOverrides: null,
    currentTestEnvScopeState: null,
    proxy: realEnv,
    realEnv,
  };

  const proxy = new Proxy(realEnv, {
    defineProperty(_target, prop, descriptor) {
      if (typeof prop !== 'string') {
        return Reflect.defineProperty(realEnv, prop, descriptor);
      }
      const layer = getWritableLayer(state);
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
      const layer = getWritableLayer(state);
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

      const scoped = getScopedLayer(state);
      if (scoped) {
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
      const layer = getWritableLayer(state);
      layer[prop] = normalizeEnvValue(value);
      return true;
    },
  });

  state.proxy = proxy;
  holder[CLIENT_PROCESS_ENV_ISOLATION_STATE] = state;

  Object.defineProperty(process, 'env', {
    configurable: true,
    enumerable: true,
    get: () => proxy,
    set: (value: NodeJS.ProcessEnv) => {
      applyEnvSnapshot(state, value);
    },
  });
}

export function beginClientTestEnvIsolation(): void {
  const state = getStateHolder()[CLIENT_PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Client process.env isolation must be installed first.');
  }
  state.currentTestEnvOverrides = {};
  state.currentTestEnvScopeState = { open: true };
}

export function endClientTestEnvIsolation(): void {
  const state = getStateHolder()[CLIENT_PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    return;
  }
  state.currentTestEnvOverrides = {};
  state.currentTestEnvScopeState = { open: false };
}

export function setScopedTestEnvValue(name: string, value: unknown): void {
  const state = getStateHolder()[CLIENT_PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Client process.env isolation must be installed first.');
  }
  if (!state.currentTestEnvScopeState) {
    state.bootstrapEnvOverrides[name] = normalizeEnvValue(value);
    return;
  }
  assertActiveScopedEnvWrite(state, name);
  state.currentTestEnvOverrides = {
    ...(state.currentTestEnvOverrides ?? {}),
    [name]: normalizeEnvValue(value),
  };
}

export function clearScopedTestEnvValue(name: string): void {
  const state = getStateHolder()[CLIENT_PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Client process.env isolation must be installed first.');
  }
  if (!state.currentTestEnvScopeState) {
    state.bootstrapEnvOverrides[name] = undefined;
    return;
  }
  assertActiveScopedEnvWrite(state, name);
  state.currentTestEnvOverrides = {
    ...(state.currentTestEnvOverrides ?? {}),
    [name]: undefined,
  };
}

export function replaceScopedTestProcessEnv(
  nextValue: Record<string, unknown> | NodeJS.ProcessEnv,
): void {
  const state = getStateHolder()[CLIENT_PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    throw new Error('Client process.env isolation must be installed first.');
  }
  if (!state.currentTestEnvScopeState) {
    const layer = state.bootstrapEnvOverrides;
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
    return;
  }
  applyEnvSnapshot(state, nextValue);
}

export function installClientTestEnvGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    clearScopedTestEnvValue?: typeof clearScopedTestEnvValue;
    replaceScopedTestProcessEnv?: typeof replaceScopedTestProcessEnv;
    setScopedTestEnvValue?: typeof setScopedTestEnvValue;
  };

  globals.setScopedTestEnvValue = setScopedTestEnvValue;
  globals.clearScopedTestEnvValue = clearScopedTestEnvValue;
  globals.replaceScopedTestProcessEnv = replaceScopedTestProcessEnv;
}

type SetScopedTestEnvValueFn = (name: string, value: unknown) => void;
type ClearScopedTestEnvValueFn = (name: string) => void;
type ReplaceScopedTestProcessEnvFn = (
  nextValue: Record<string, unknown> | NodeJS.ProcessEnv,
) => void;

declare global {
  var setScopedTestEnvValue: SetScopedTestEnvValueFn;
  var clearScopedTestEnvValue: ClearScopedTestEnvValueFn;
  var replaceScopedTestProcessEnv: ReplaceScopedTestProcessEnvFn;
}
