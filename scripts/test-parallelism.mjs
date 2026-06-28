import { availableParallelism } from 'node:os';

const parsePositiveInteger = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
};

export const computeHalfAvailableCoresMinTwo = () => {
  const availableCores = Math.max(1, availableParallelism());
  const requestedWorkers = Math.max(2, Math.floor(availableCores / 2));
  const workerCount = Math.min(availableCores, requestedWorkers);

  return {
    availableCores,
    workerCount,
  };
};

export const resolveWorkerSetting = (overrideValue) => {
  const baseline = computeHalfAvailableCoresMinTwo();
  const overrideWorkers = parsePositiveInteger(overrideValue);

  if (overrideWorkers === null) {
    return {
      ...baseline,
      workerArgValue: String(baseline.workerCount),
      source: 'auto-half-cores-min-two',
    };
  }

  return {
    ...baseline,
    workerCount: Math.min(baseline.availableCores, overrideWorkers),
    workerArgValue: String(Math.min(baseline.availableCores, overrideWorkers)),
    source: 'explicit-override',
  };
};

export const formatWorkerSummaryLine = ({
  label,
  availableCores,
  workerCount,
  source,
}) =>
  `${label}=${workerCount} available_cores=${availableCores} source=${source}`;
