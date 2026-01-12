import { getApiBaseUrl } from '../../api/baseUrl';

const serverBase = getApiBaseUrl();

export type IngestDirsSuccess = {
  base: string;
  path: string;
  dirs: string[];
};

export type IngestDirsErrorCode =
  | 'OUTSIDE_BASE'
  | 'NOT_FOUND'
  | 'NOT_DIRECTORY';

export type IngestDirsError = {
  status: 'error';
  code: IngestDirsErrorCode;
};

export type IngestDirsResponse = IngestDirsSuccess | IngestDirsError;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isIngestDirsError = (value: unknown): value is IngestDirsError =>
  isObject(value) &&
  value.status === 'error' &&
  (value.code === 'OUTSIDE_BASE' ||
    value.code === 'NOT_FOUND' ||
    value.code === 'NOT_DIRECTORY');

const isIngestDirsSuccess = (value: unknown): value is IngestDirsSuccess =>
  isObject(value) &&
  typeof value.base === 'string' &&
  typeof value.path === 'string' &&
  Array.isArray(value.dirs) &&
  value.dirs.every((dir) => typeof dir === 'string');

export async function fetchIngestDirs(params: {
  path?: string;
}): Promise<IngestDirsResponse> {
  const qs = new URLSearchParams();
  const candidate = params.path?.trim();
  if (candidate) qs.set('path', candidate);

  const q = qs.toString();
  const url = new URL(
    q ? `/ingest/dirs?${q}` : '/ingest/dirs',
    serverBase,
  ).toString();

  const res = await fetch(url);
  const payload = (await res.json().catch(() => null)) as unknown;

  if (isIngestDirsError(payload) || isIngestDirsSuccess(payload)) {
    return payload;
  }

  const message = res.ok
    ? 'Unexpected ingest/dirs payload'
    : `ingest/dirs request failed (${res.status})`;
  throw new Error(message);
}
