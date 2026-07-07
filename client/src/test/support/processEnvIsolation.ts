type EnvOverlay = Record<string, string | undefined>;

type ClientProcessEnvIsolationState = {
  bootstrapEnvOverrides: EnvOverlay;
  currentTestEnvOverrides: EnvOverlay | null;
  proxy: NodeJS.ProcessEnv;
  realEnv: NodeJS.ProcessEnv;
};

const CLIENT_PROCESS_ENV_ISOLATION_STATE = Symbol.for(
  'codeinfo2.clientTest.processEnvIsolationState',
);

const hasOwn = (record: EnvOverlay, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

const normalizeEnvValue = (value: unknown): string => String(value);

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

const getWritableLayer = (state: ClientProcessEnvIsolationState): EnvOverlay =>
  getScopedLayer(state) ?? state.bootstrapEnvOverrides;

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
  const layer = getWritableLayer(state);
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
    layer[key] =
      value === undefined ? undefined : normalizeEnvValue(value);
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
}

export function endClientTestEnvIsolation(): void {
  const state = getStateHolder()[CLIENT_PROCESS_ENV_ISOLATION_STATE];
  if (!state) {
    return;
  }
  state.currentTestEnvOverrides = null;
}
