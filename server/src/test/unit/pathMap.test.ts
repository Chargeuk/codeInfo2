import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';
import {
  mapHostWorkingFolderToWorkdir,
  mapIngestPath,
} from '../../ingest/pathMap.js';

const ORIGINAL_HOST = process.env.HOST_INGEST_DIR;

beforeEach(() => {
  delete process.env.HOST_INGEST_DIR;
});

afterEach(() => {
  if (ORIGINAL_HOST === undefined) {
    delete process.env.HOST_INGEST_DIR;
  } else {
    process.env.HOST_INGEST_DIR = ORIGINAL_HOST;
  }
});

test('maps container path to host path with env override', () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const result = mapIngestPath('/data/repo/src/file.ts');

  assert.equal(result.repo, 'repo');
  assert.equal(result.relPath, 'src/file.ts');
  assert.equal(result.containerPath, '/data/repo/src/file.ts');
  assert.equal(result.hostPath, '/host/base/repo/src/file.ts');
  assert.equal(result.hostPathWarning, undefined);
});

test('adds hostPathWarning when HOST_INGEST_DIR is missing', () => {
  delete process.env.HOST_INGEST_DIR;

  const result = mapIngestPath('/data/repo/file.txt');

  assert.equal(result.repo, 'repo');
  assert.equal(result.relPath, 'file.txt');
  assert.equal(result.hostPath, '/data/repo/file.txt');
  assert.ok(result.hostPathWarning);
});

test('handles non-standard paths without throwing', () => {
  process.env.HOST_INGEST_DIR = '/host/base';

  const result = mapIngestPath('repo/nested/path.md');

  assert.equal(result.repo, 'repo');
  assert.equal(result.relPath, 'nested/path.md');
  assert.equal(result.hostPath, '/host/base/repo/nested/path.md');
});

describe('mapHostWorkingFolderToWorkdir', () => {
  test('maps host path under ingest root', () => {
    const result = mapHostWorkingFolderToWorkdir({
      hostIngestDir: '/host/base',
      codexWorkdir: '/data',
      hostWorkingFolder: '/host/base/repo/sub',
    });

    assert.ok('mappedPath' in result);
    assert.equal(result.relPath, 'repo/sub');
    assert.ok(result.mappedPath.endsWith('/data/repo/sub'));
  });

  test('rejects outside ingest root', () => {
    const result = mapHostWorkingFolderToWorkdir({
      hostIngestDir: '/host/base',
      codexWorkdir: '/data',
      hostWorkingFolder: '/host/other/repo',
    });

    assert.ok('error' in result);
    assert.equal(result.error.code, 'OUTSIDE_HOST_INGEST_DIR');
  });

  test('rejects prefix-but-not-child', () => {
    const result = mapHostWorkingFolderToWorkdir({
      hostIngestDir: '/host/base',
      codexWorkdir: '/data',
      hostWorkingFolder: '/host/base2/repo',
    });

    assert.ok('error' in result);
    assert.equal(result.error.code, 'OUTSIDE_HOST_INGEST_DIR');
  });

  test('rejects non-absolute input', () => {
    const result = mapHostWorkingFolderToWorkdir({
      hostIngestDir: '/host/base',
      codexWorkdir: '/data',
      hostWorkingFolder: 'relative/path',
    });

    assert.ok('error' in result);
    assert.equal(result.error.code, 'INVALID_ABSOLUTE_PATH');
  });
});
