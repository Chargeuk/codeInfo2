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

type HostWorkingFolderMapResult =
  | { mappedPath: string; relPath: string }
  | {
      error: {
        code: 'INVALID_ABSOLUTE_PATH' | 'OUTSIDE_HOST_INGEST_DIR';
        reason: string;
      };
    };

export function mapHostWorkingFolderToWorkdir(params: {
  hostIngestDir: string;
  codexWorkdir: string;
  hostWorkingFolder: string;
}): HostWorkingFolderMapResult {
  const normalizedHostWorkingFolder = path.posix.normalize(
    params.hostWorkingFolder.replace(/\\/g, '/'),
  );

  if (!path.posix.isAbsolute(normalizedHostWorkingFolder)) {
    return {
      error: {
        code: 'INVALID_ABSOLUTE_PATH',
        reason: 'hostWorkingFolder must be an absolute POSIX path',
      },
    };
  }

  const normalizedHostIngestDir = path.posix.normalize(
    params.hostIngestDir.replace(/\\/g, '/'),
  );
  if (!path.posix.isAbsolute(normalizedHostIngestDir)) {
    return {
      error: {
        code: 'INVALID_ABSOLUTE_PATH',
        reason: 'hostIngestDir must be an absolute POSIX path',
      },
    };
  }

  const normalizedCodexWorkdir = path.posix.normalize(
    params.codexWorkdir.replace(/\\/g, '/'),
  );

  const hostIngestDirNoTrailingSlash =
    normalizedHostIngestDir !== '/' && normalizedHostIngestDir.endsWith('/')
      ? normalizedHostIngestDir.slice(0, -1)
      : normalizedHostIngestDir;

  let relPath = '';
  if (hostIngestDirNoTrailingSlash === '/') {
    relPath =
      normalizedHostWorkingFolder === '/'
        ? ''
        : normalizedHostWorkingFolder.slice(1);
  } else if (normalizedHostWorkingFolder === hostIngestDirNoTrailingSlash) {
    relPath = '';
  } else if (
    normalizedHostWorkingFolder.startsWith(`${hostIngestDirNoTrailingSlash}/`)
  ) {
    relPath = normalizedHostWorkingFolder.slice(
      hostIngestDirNoTrailingSlash.length + 1,
    );
  } else {
    return {
      error: {
        code: 'OUTSIDE_HOST_INGEST_DIR',
        reason: 'hostWorkingFolder is outside hostIngestDir',
      },
    };
  }

  return {
    mappedPath: path.posix.join(normalizedCodexWorkdir, relPath),
    relPath,
  };
}
