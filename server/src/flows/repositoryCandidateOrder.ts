import path from 'node:path';

export const DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER =
  'DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER';

export type RepositoryCandidateOrderSlot =
  | 'working_repository'
  | 'owner_repository'
  | 'codeinfo2'
  | 'other_repository';

export type RepositoryCandidateOrderCaller = string;

export type RepositoryCandidateOrderInput = {
  sourceId: string;
  sourceLabel?: string;
};

export type RepositoryCandidateOrderEntry = {
  sourceId: string;
  sourceLabel: string;
  slot: RepositoryCandidateOrderSlot;
};

export type RepositoryCandidateOrderResult = {
  caller: RepositoryCandidateOrderCaller;
  workingRepositoryAvailable: boolean;
  candidates: RepositoryCandidateOrderEntry[];
};

const normalizeAsciiLower = (value: string) => value.toLowerCase();

export const normalizeRepositoryCandidateLabel = (params: {
  sourceId: string;
  sourceLabel?: string;
}) => {
  const trimmed = params.sourceLabel?.trim();
  if (trimmed) return trimmed;
  return path.posix.basename(params.sourceId.replace(/\\/g, '/'));
};

const normalizeCandidateKey = (sourceId: string) =>
  normalizeAsciiLower(path.resolve(sourceId));

export const buildRepositoryCandidateOrder = (params: {
  caller: RepositoryCandidateOrderCaller;
  workingRepositoryPath?: string | null;
  ownerRepositoryPath?: string | null;
  ownerRepositoryLabel?: string;
  codeInfo2Root: string;
  otherRepositoryRoots: RepositoryCandidateOrderInput[];
}): RepositoryCandidateOrderResult => {
  const candidates: RepositoryCandidateOrderEntry[] = [];
  const seen = new Set<string>();

  const addCandidate = (
    input: RepositoryCandidateOrderInput | undefined,
    slot: RepositoryCandidateOrderSlot,
  ) => {
    const trimmedSourceId = input?.sourceId?.trim();
    if (!trimmedSourceId) return;

    const resolvedSourceId = path.resolve(trimmedSourceId);
    const seenKey = normalizeCandidateKey(resolvedSourceId);
    if (seen.has(seenKey)) return;
    seen.add(seenKey);

    candidates.push({
      sourceId: resolvedSourceId,
      sourceLabel: normalizeRepositoryCandidateLabel({
        sourceId: resolvedSourceId,
        sourceLabel: input?.sourceLabel,
      }),
      slot,
    });
  };

  const workingRepositoryPath = params.workingRepositoryPath?.trim();
  const ownerRepositoryPath = params.ownerRepositoryPath?.trim();

  addCandidate(
    workingRepositoryPath ? { sourceId: workingRepositoryPath } : undefined,
    'working_repository',
  );
  addCandidate(
    ownerRepositoryPath
      ? {
          sourceId: ownerRepositoryPath,
          sourceLabel: params.ownerRepositoryLabel,
        }
      : undefined,
    'owner_repository',
  );
  addCandidate({ sourceId: params.codeInfo2Root }, 'codeinfo2');

  for (const repo of params.otherRepositoryRoots) {
    addCandidate(repo, 'other_repository');
  }

  return {
    caller: params.caller,
    workingRepositoryAvailable: Boolean(workingRepositoryPath),
    candidates,
  };
};
