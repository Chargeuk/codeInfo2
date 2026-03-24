import {
  DEFAULT_TASK16_SCENARIO,
  TASK16_LOG_MARKER,
  getTask16BootLogContext,
  type NamedCopilotScenario,
  resolveNamedCopilotScenario,
  resolveNamedCopilotScenarioFromEnv,
} from '../../server/src/test/support/copilotScenarioCatalog';

export const TASK18_LOG_MARKER =
  'story.0000051.task18.playwright_scenarios_registered';

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

export function getNamedE2ECopilotScenario(name: NamedCopilotScenario) {
  return resolveNamedCopilotScenario(name);
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

export function logPlaywrightCopilotScenarioRegistration(params: {
  spec: string;
  scenarioName?: NamedCopilotScenario;
  env?: NodeJS.ProcessEnv;
}) {
  const scenario =
    params.scenarioName !== undefined
      ? getNamedE2ECopilotScenario(params.scenarioName)
      : getE2ECopilotScenario(params.env);
  console.info(TASK18_LOG_MARKER, {
    scenario: scenario.name,
    spec: params.spec,
    surface: 'e2e',
  });
  return scenario;
}
