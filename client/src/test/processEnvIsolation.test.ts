import {
  beginClientTestEnvIsolation,
  clearScopedTestEnvValue,
  endClientTestEnvIsolation,
  replaceScopedTestProcessEnv,
  setScopedTestEnvValue,
} from './support/processEnvIsolation';

describe('client process env isolation', () => {
  test('scoped env value is visible inside the active test scope', async () => {
    setScopedTestEnvValue('DEV_CLIENT_PROCESS_ENV_CANARY', 'a');
    expect(process.env.DEV_CLIENT_PROCESS_ENV_CANARY).toBe('a');
  });

  test('scoped env value from a previous test is not visible in the next test', async () => {
    expect(process.env.DEV_CLIENT_PROCESS_ENV_CANARY).toBeUndefined();
    setScopedTestEnvValue('DEV_CLIENT_PROCESS_ENV_CANARY', 'b');
    expect(process.env.DEV_CLIENT_PROCESS_ENV_CANARY).toBe('b');
  });

  test('replaceScopedTestProcessEnv stays scoped to the active test', () => {
    replaceScopedTestProcessEnv({
      ...process.env,
      DEV_CLIENT_PROCESS_ENV_REPLACE_CANARY: 'scoped',
    });

    expect(process.env.DEV_CLIENT_PROCESS_ENV_REPLACE_CANARY).toBe('scoped');
  });

  test('out-of-scope scoped env helpers throw immediately', () => {
    beginClientTestEnvIsolation();
    endClientTestEnvIsolation();

    expect(() =>
      setScopedTestEnvValue('DEV_CLIENT_PROCESS_ENV_OUT_OF_SCOPE', 'nope'),
    ).toThrow(/outside an active test scope/);
    expect(() =>
      clearScopedTestEnvValue('DEV_CLIENT_PROCESS_ENV_OUT_OF_SCOPE'),
    ).toThrow(/outside an active test scope/);

    beginClientTestEnvIsolation();
  });
});
