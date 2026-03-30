import {
  listIngestedRepositories,
  type ListReposResult,
  type RepoEntry,
} from '../lmstudio/toolService.js';
import { normalizeCanonicalQueueTargetPath } from '../ingest/requestContracts.js';

export type RepositorySelectorDeps = {
  listIngestedRepositories?: () => Promise<ListReposResult>;
};

function parseIsoTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeRepositoryId(value: string): string {
  return value.trim().toLowerCase();
}

function selectLatestRepo(
  repos: RepoEntry[],
  predicate: (repo: RepoEntry) => boolean,
): RepoEntry | null {
  const matches = repos.filter(predicate);
  if (matches.length === 0) {
    return null;
  }

  return matches.reduce((best, current) => {
    const bestTs = parseIsoTimestamp(best.lastIngestAt);
    const currentTs = parseIsoTimestamp(current.lastIngestAt);
    if (currentTs === bestTs) {
      return best;
    }
    return currentTs > bestTs ? current : best;
  });
}

export async function resolveRepositorySelector(
  input: string | undefined,
  deps: RepositorySelectorDeps = {},
): Promise<RepoEntry | null> {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return null;
  }

  const listRepos = deps.listIngestedRepositories ?? listIngestedRepositories;
  const { repos } = await listRepos();

  const normalizedId = normalizeRepositoryId(input);
  const byId = selectLatestRepo(
    repos,
    (repo) => normalizeRepositoryId(repo.id) === normalizedId,
  );
  if (byId) {
    return byId;
  }

  const normalizedPath = normalizeCanonicalQueueTargetPath(input);
  const byContainerPath = selectLatestRepo(
    repos,
    (repo) =>
      normalizeCanonicalQueueTargetPath(repo.containerPath) === normalizedPath,
  );
  if (byContainerPath) {
    return byContainerPath;
  }

  return selectLatestRepo(
    repos,
    (repo) => normalizeCanonicalQueueTargetPath(repo.hostPath) === normalizedPath,
  );
}
