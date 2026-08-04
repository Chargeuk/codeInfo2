import { availableParallelism } from 'node:os';

import { allocateWeightedParallelBudget } from './test-parallelism.mjs';

const parsePositiveInteger = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
};

export const resolveAllParallelConfiguration = ({
  stress = false,
  serverUnitOverride,
  availableCores = availableParallelism(),
} = {}) => {
  const normalizedAvailableCores = Math.max(
    1,
    Math.floor(Number(availableCores)) || 1,
  );
  const baseAllocation = allocateWeightedParallelBudget({
    availableCores: normalizedAvailableCores,
    budgetFraction: 0.6,
    weights: {
      client: 3,
      e2e: 3,
      'server:unit': 12,
    },
    reservedWorkers: {
      'server:cucumber': 1,
    },
  });
  const workerCounts = { ...baseAllocation.workerCounts };
  let serverUnitSource = baseAllocation.source;

  if (stress) {
    const unusedCores = Math.max(
      0,
      normalizedAvailableCores - baseAllocation.effectiveBudget,
    );
    workerCounts['server:unit'] += unusedCores;
    serverUnitSource = 'stress-unused-capacity';
  }

  const requestedServerUnitConcurrency =
    parsePositiveInteger(serverUnitOverride);
  if (requestedServerUnitConcurrency !== null) {
    workerCounts['server:unit'] = Math.min(
      normalizedAvailableCores,
      requestedServerUnitConcurrency,
    );
    serverUnitSource = 'env-override';
  }

  const effectiveBudget = Object.values(workerCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  return {
    ...baseAllocation,
    effectiveBudget,
    mode: stress ? 'stress' : 'normal',
    source: serverUnitSource,
    serverUnitSource,
    workerCounts,
  };
};

export const buildAllParallelEnvironment = ({
  environment = process.env,
  stress = false,
} = {}) => ({
  ...environment,
  ...(stress ? { CODEINFO_TEST_RUNTIME_DIAGNOSTICS: '1' } : {}),
});
