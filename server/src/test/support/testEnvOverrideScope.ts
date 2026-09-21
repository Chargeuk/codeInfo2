import {
  clearBootstrapTestEnvValue,
  setBootstrapTestEnvValue,
  shouldMirrorEnvKeyToBootstrap,
} from './processEnvIsolation.js';
import {
  bindCurrentTestOverrides as bindCurrentOverrides,
  enterTestOverrideScope as enterOverrides,
  getScopedEnvValue as getEnvValue,
  getScopedProcessEnv as getProcessEnv,
  runWithTestOverrides as runWithOverrides,
} from './testOverrideScope.js';

export function enterTestEnvOverrides(
  overrides: Record<string, string | undefined>,
): void {
  enterOverrides({ envOverrides: overrides });
}

export async function runWithTestEnvOverrides<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const mirroredEntries = Object.entries(overrides).filter(([key]) =>
    shouldMirrorEnvKeyToBootstrap(key),
  );
  const previousValues = new Map<string, string | undefined>();

  for (const [key] of mirroredEntries) {
    previousValues.set(key, process.env[key]);
  }

  try {
    for (const [key, value] of mirroredEntries) {
      if (value === undefined) {
        clearBootstrapTestEnvValue(key);
      } else {
        setBootstrapTestEnvValue(key, value);
      }
    }
    return await runWithOverrides({ envOverrides: overrides }, fn);
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        clearBootstrapTestEnvValue(key);
      } else {
        setBootstrapTestEnvValue(key, value);
      }
    }
  }
}

export const bindCurrentTestEnvOverrides = bindCurrentOverrides;
export { getEnvValue as getScopedEnvValue, getProcessEnv as getScopedProcessEnv };
