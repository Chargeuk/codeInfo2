import path from 'path';

const DEFAULT_CONTAINER_ROOT = '/data';

export type MappedPath = {
  repo: string;
  relPath: string;
  containerPath: string;
  hostPath: string;
  hostPathWarning?: string;
};

export function mapIngestPath(
  containerPath: string,
  hostIngestDir = process.env.HOST_INGEST_DIR || DEFAULT_CONTAINER_ROOT,
): MappedPath {
  const normalizedContainer = path.posix.normalize(
    containerPath.replace(/\\/g, '/'),
  );

  let repo = '';
  let relPath = '';

  const containerPrefix = `${DEFAULT_CONTAINER_ROOT}/`;
  if (normalizedContainer.startsWith(containerPrefix)) {
    const remainder = normalizedContainer.slice(containerPrefix.length);
    const segments = remainder.split('/');
    repo = segments.shift() ?? '';
    relPath = segments.join('/');
  } else {
    const segments = normalizedContainer.split('/').filter(Boolean);
    repo = segments.shift() ?? '';
    relPath = segments.join('/');
  }

  const normalizedHostRoot = path.posix.normalize(
    hostIngestDir.replace(/\\/g, '/'),
  );
  const hostPath = repo
    ? path.posix.join(normalizedHostRoot, repo, relPath)
    : path.posix.join(normalizedHostRoot, relPath);

  const hostPathWarning = process.env.HOST_INGEST_DIR
    ? undefined
    : 'HOST_INGEST_DIR not set; using container path base';

  return {
    repo,
    relPath,
    containerPath: normalizedContainer,
    hostPath,
    ...(hostPathWarning ? { hostPathWarning } : {}),
  };
}
