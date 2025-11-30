import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { mapIngestPath } from '../../ingest/pathMap.js';

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
