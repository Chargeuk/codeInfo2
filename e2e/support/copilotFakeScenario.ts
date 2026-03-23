import {
  DEFAULT_TASK16_SCENARIO,
  TASK16_LOG_MARKER,
  getTask16BootLogContext,
  resolveNamedCopilotScenario,
  resolveNamedCopilotScenarioFromEnv,
} from '../../server/src/test/support/copilotScenarioCatalog';

export function getE2ECopilotScenarioName(
  env: NodeJS.ProcessEnv = process.env,
) {
  return (
    resolveNamedCopilotScenarioFromEnv(env)?.name ??
    resolveNamedCopilotScenario(DEFAULT_TASK16_SCENARIO).name
  );
}

export function getE2ECopilotScenario(env: NodeJS.ProcessEnv = process.env) {
  return resolveNamedCopilotScenario(getE2ECopilotScenarioName(env));
}

export function logE2ECopilotScenarioBoot(
  env: NodeJS.ProcessEnv = process.env,
) {
  const scenario = getE2ECopilotScenario(env);
  console.info(
    TASK16_LOG_MARKER,
    getTask16BootLogContext({
      scenarioName: scenario.name,
      surface: 'e2e',
    }),
  );
  return scenario;
}
