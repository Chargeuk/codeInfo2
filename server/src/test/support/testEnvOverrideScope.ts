import {
  bindCurrentTestOverrides,
  enterTestOverrideScope,
  getScopedEnvValue,
  getScopedProcessEnv,
  runWithTestOverrides,
} from './testOverrideScope.js';

export function enterTestEnvOverrides(
  overrides: Record<string, string | undefined>,
): void {
  enterTestOverrideScope({ envOverrides: overrides });
}

export async function runWithTestEnvOverrides<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  return await runWithTestOverrides({ envOverrides: overrides }, fn);
}

export const bindCurrentTestEnvOverrides = bindCurrentTestOverrides;
export { getScopedEnvValue, getScopedProcessEnv };
