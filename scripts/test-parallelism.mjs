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

export const allocateWeightedParallelBudget = ({
  budgetFraction = 0.75,
  weights,
  reservedWorkers = {},
}) => {
  const availableCores = Math.max(1, availableParallelism());
  const entries = Object.entries(weights);
  const reservedEntries = Object.entries(reservedWorkers).map(
    ([label, count]) => [
      label,
      Math.max(1, Number.parseInt(String(count), 10) || 1),
    ],
  );
  const reservedBudget = reservedEntries.reduce(
    (sum, [, count]) => sum + count,
    0,
  );
  const minimumBudget = Math.max(1, entries.length + reservedBudget);
  const scaledBudget = Math.floor(availableCores * budgetFraction);
  const budget = Math.max(minimumBudget, scaledBudget);
  const weightedBudget = budget - reservedBudget;
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);

  const provisional = entries.map(([label, weight]) => {
    const exact = (weightedBudget * weight) / totalWeight;
    const base = Math.floor(exact);
    return {
      label,
      exact,
      base,
      remainder: exact - base,
    };
  });

  let assigned = provisional.reduce((sum, item) => sum + item.base, 0);
  let remaining = weightedBudget - assigned;

  provisional.sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return right.exact - left.exact;
  });

  for (const item of provisional) {
    if (remaining <= 0) break;
    item.base += 1;
    remaining -= 1;
  }

  // Keep at least one worker per configured harness even on tiny machines.
  // This can intentionally push the effective total above the weighted budget,
  // and that tradeoff is part of the agreed design for these wrappers.
  const workerCounts = Object.fromEntries(
    [
      ...provisional.map((item) => [item.label, Math.max(1, item.base)]),
      ...reservedEntries,
    ].sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel)),
  );
  const effectiveBudget = Object.values(workerCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  return {
    availableCores,
    budget,
    budgetFraction,
    effectiveBudget,
    reservedBudget,
    weightedBudget,
    workerCounts,
    source: `weighted-${Math.round(budgetFraction * 100)}pct-budget`,
  };
};
