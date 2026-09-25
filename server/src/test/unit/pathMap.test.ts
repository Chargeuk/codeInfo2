import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe } from 'node:test';
import { describeMountedWorkingFolder, mapHostWorkingFolderToWorkdir, mapIngestPath, resolveMountedIngestPath, } from '../../ingest/pathMap.js';
const ORIGINAL_HOST = process.env.CODEINFO_HOST_INGEST_DIR;
beforeEach(() => {
    clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
});
afterEach(() => {
    if (ORIGINAL_HOST === undefined) {
        clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", ORIGINAL_HOST);
    }
});
test('maps container path to host path with env override', () => {
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/host/base');
    const result = mapIngestPath('/data/repo/src/file.ts');
    assert.equal(result.repo, 'repo');
    assert.equal(result.relPath, 'src/file.ts');
    assert.equal(result.containerPath, '/data/repo/src/file.ts');
    assert.equal(result.hostPath, '/host/base/repo/src/file.ts');
    assert.equal(result.hostPathWarning, undefined);
});
test('adds hostPathWarning when CODEINFO_HOST_INGEST_DIR is missing', () => {
    clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
    const result = mapIngestPath('/data/repo/file.txt');
    assert.equal(result.repo, 'repo');
    assert.equal(result.relPath, 'file.txt');
    assert.equal(result.hostPath, '/data/repo/file.txt');
    assert.ok(result.hostPathWarning);
});
test('handles non-standard paths without throwing', () => {
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/host/base');
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
    test('maps aligned host ingest and workdir roots for mounted working repositories', () => {
        const result = mapHostWorkingFolderToWorkdir({
            hostIngestDir: '/host/ingest',
            codexWorkdir: '/workspace/repos',
            hostWorkingFolder: '/host/ingest/repo-owner/codeInfoStatus',
        });
        assert.ok('mappedPath' in result);
        assert.equal(result.relPath, 'repo-owner/codeInfoStatus');
        assert.equal(result.mappedPath, '/workspace/repos/repo-owner/codeInfoStatus');
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
describe('resolveMountedIngestPath', () => {
    test('prefers the active codex workdir path when a listed root still carries a legacy /data container path', () => {
        const result = resolveMountedIngestPath({
            containerPath: '/data/codeInfo2/codeInfo2',
            hostPath: '/home/d_a_s/code/codeInfo2/codeInfo2',
            hostIngestDir: '/home/d_a_s/code',
            codexWorkdir: '/home/d_a_s/code',
        });
        assert.equal(result, '/home/d_a_s/code/codeInfo2/codeInfo2');
    });
    test('falls back to the listed container path when the host path cannot be mapped into the active workdir', () => {
        const result = resolveMountedIngestPath({
            containerPath: '/data/codeInfo2/codeInfo2',
            hostPath: '/different-root/codeInfo2/codeInfo2',
            hostIngestDir: '/home/d_a_s/code',
            codexWorkdir: '/home/d_a_s/code',
        });
        assert.equal(result, '/data/codeInfo2/codeInfo2');
    });
    test('preserves absolute host-style roots outside the ingest mount instead of fabricating a remapped host path', () => {
        const mapped = mapIngestPath('/home/d_a_s/tmp/example-repo');
        assert.equal(mapped.hostPath, '/home/d_a_s/tmp/example-repo');
        const result = resolveMountedIngestPath({
            containerPath: '/home/d_a_s/tmp/example-repo',
            hostPath: mapped.hostPath,
            hostIngestDir: '/home/d_a_s/code',
            codexWorkdir: '/home/d_a_s/code',
        });
        assert.equal(result, '/home/d_a_s/tmp/example-repo');
    });
});
describe('describeMountedWorkingFolder', () => {
    test('reports mounted working folders when host and workdir roots align', () => {
        const result = describeMountedWorkingFolder({
            hostIngestDir: '/host/ingest',
            codexWorkdir: '/workspace/repos',
            hostWorkingFolder: '/host/ingest/repo-owner',
        });
        assert.deepEqual(result, {
            mounted: true,
            mappedPath: '/workspace/repos/repo-owner',
            relPath: 'repo-owner',
        });
    });
    test('reports non-mounted working folders outside the ingest root', () => {
        const result = describeMountedWorkingFolder({
            hostIngestDir: '/host/ingest',
            codexWorkdir: '/workspace/repos',
            hostWorkingFolder: '/host/other/repo-owner',
        });
        assert.deepEqual(result, {
            mounted: false,
            reason: 'outside_host_ingest_dir',
            errorCode: 'OUTSIDE_HOST_INGEST_DIR',
        });
    });
});
