import { hashFlowInput, normalizeFlowInput } from './flowInput.js';
import type { FlowSubflowWaveStep } from './flowSchema.js';
import type { FlowJsonObject, FlowJsonValue } from './types.js';

export type SubflowWaveJob = {
  instanceId: string;
  flowName: string;
  targetId?: string;
  workingFolder?: string;
  input?: FlowJsonObject;
  inputHash?: string;
  displayName: string;
};

const isRecord = (value: unknown): value is Record<string, FlowJsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const resolveFlowValue = (
  root: Record<string, FlowJsonValue>,
  bindingPath: string,
): FlowJsonValue | undefined => {
  let current: FlowJsonValue | undefined = root;
  for (const segment of bindingPath.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
};

const buildBindings = (params: {
  root: Record<string, FlowJsonValue>;
  bindings?: {
    workingFolderFrom?: string;
    input?: Record<string, string>;
  };
}): Pick<SubflowWaveJob, 'workingFolder' | 'input' | 'inputHash'> => {
  const workingFolder = params.bindings?.workingFolderFrom
    ? resolveFlowValue(params.root, params.bindings.workingFolderFrom)
    : undefined;
  if (params.bindings?.workingFolderFrom && workingFolder === undefined) {
    throw new Error(
      `Wave working-folder binding "${params.bindings.workingFolderFrom}" did not resolve.`,
    );
  }
  if (workingFolder !== undefined && typeof workingFolder !== 'string') {
    throw new Error('Wave working-folder binding must resolve to a string.');
  }
  const inputEntries = Object.entries(params.bindings?.input ?? {}).map(
    ([key, bindingPath]) => {
      const value = resolveFlowValue(params.root, bindingPath);
      if (value === undefined) {
        throw new Error(
          `Wave input binding "${bindingPath}" for "${key}" did not resolve.`,
        );
      }
      return [key, value] as const;
    },
  );
  const input =
    inputEntries.length > 0
      ? normalizeFlowInput(Object.fromEntries(inputEntries))
      : undefined;
  return {
    ...(workingFolder ? { workingFolder } : {}),
    ...(input ? { input, inputHash: hashFlowInput(input) } : {}),
  };
};

const targetIdentity = (item: FlowJsonValue, index: number): string => {
  if (isRecord(item)) {
    for (const key of ['target_id', 'targetId', 'repo_alias', 'id']) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return String(index);
};

export const expandSubflowWaveJobs = (params: {
  step: FlowSubflowWaveStep;
  input: FlowJsonObject;
}): SubflowWaveJob[] => {
  const jobs: SubflowWaveJob[] = [];
  for (const group of params.step.groups) {
    if (group.kind === 'singleton') {
      const bindings = buildBindings({
        root: params.input,
        bindings: group.bindings,
      });
      jobs.push({
        instanceId: `${group.id}:${group.flowName}`,
        flowName: group.flowName,
        displayName: group.flowName,
        ...bindings,
      });
      continue;
    }

    const items = resolveFlowValue(params.input, group.itemsFrom);
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(
        `Wave matrix source "${group.itemsFrom}" must resolve to a non-empty array.`,
      );
    }
    items.forEach((item, index) => {
      const targetId = targetIdentity(item, index);
      const root = {
        ...params.input,
        [group.itemName]: item,
      } as Record<string, FlowJsonValue>;
      const bindings = buildBindings({ root, bindings: group.bindings });
      group.flowNames.forEach((flowName) => {
        jobs.push({
          instanceId: `${group.id}:${targetId}:${flowName}`,
          flowName,
          targetId,
          displayName: `${flowName} [${targetId}]`,
          ...bindings,
        });
      });
    });
  }

  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.instanceId)) {
      throw new Error(`Duplicate wave job instance "${job.instanceId}".`);
    }
    seen.add(job.instanceId);
  }
  return jobs;
};
