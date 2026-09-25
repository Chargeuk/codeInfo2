import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createIngestDirsRouter } from '../../routes/ingestDirs.js';
const ORIGINAL_HOST = process.env.CODEINFO_HOST_INGEST_DIR;
const ORIGINAL_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;
let baseDir = '';
beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'codeinfo2-ingest-dirs-'));
    setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", baseDir);
    setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", baseDir);
    await mkdir(path.join(baseDir, 'repo-b'));
    await mkdir(path.join(baseDir, 'repo-a'));
    await writeFile(path.join(baseDir, 'file.txt'), 'hello');
});
afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
    if (ORIGINAL_HOST === undefined) {
        clearScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", ORIGINAL_HOST);
    }
    if (ORIGINAL_CODEX_WORKDIR === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_WORKDIR");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", ORIGINAL_CODEX_WORKDIR);
    }
});
function buildApp() {
    const app = express();
    app.use(createIngestDirsRouter());
    return app;
}
test('default request lists child dirs under base', async () => {
    const res = await request(buildApp()).get('/ingest/dirs');
    assert.equal(res.status, 200);
    assert.equal(res.body.base, baseDir);
    assert.equal(res.body.path, baseDir);
    assert.deepEqual(res.body.dirs, ['repo-a', 'repo-b']);
});
test('empty path query behaves like omitted path', async () => {
    const res = await request(buildApp()).get('/ingest/dirs?path=');
    assert.equal(res.status, 200);
    assert.equal(res.body.base, baseDir);
    assert.equal(res.body.path, baseDir);
    assert.deepEqual(res.body.dirs, ['repo-a', 'repo-b']);
});
test('whitespace path query behaves like omitted path', async () => {
    const res = await request(buildApp()).get('/ingest/dirs?path=%20%20%20');
    assert.equal(res.status, 200);
    assert.equal(res.body.base, baseDir);
    assert.equal(res.body.path, baseDir);
    assert.deepEqual(res.body.dirs, ['repo-a', 'repo-b']);
});
test('non-string path query behaves like omitted path', async () => {
    const res = await request(buildApp()).get('/ingest/dirs?path=a&path=b');
    assert.equal(res.status, 200);
    assert.equal(res.body.base, baseDir);
    assert.equal(res.body.path, baseDir);
    assert.deepEqual(res.body.dirs, ['repo-a', 'repo-b']);
});
test('returned dirs are sorted ascending', async () => {
    const res = await request(buildApp()).get('/ingest/dirs');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.dirs, ['repo-a', 'repo-b']);
});
test('OUTSIDE_BASE for a path outside the base', async () => {
    const outside = path.dirname(baseDir);
    const res = await request(buildApp()).get(`/ingest/dirs?path=${encodeURIComponent(outside)}`);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { status: 'error', code: 'OUTSIDE_BASE' });
});
test('NOT_FOUND for missing path inside base', async () => {
    const missing = path.join(baseDir, 'missing');
    const res = await request(buildApp()).get(`/ingest/dirs?path=${encodeURIComponent(missing)}`);
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { status: 'error', code: 'NOT_FOUND' });
});
test('NOT_DIRECTORY when path points at a file', async () => {
    const filePath = path.join(baseDir, 'file.txt');
    const res = await request(buildApp()).get(`/ingest/dirs?path=${encodeURIComponent(filePath)}`);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { status: 'error', code: 'NOT_DIRECTORY' });
});
test('maps host ingest paths into the configured codex workdir before listing', async () => {
    const mappedRoot = await mkdtemp(path.join(os.tmpdir(), 'codeinfo2-ingest-dirs-mapped-'));
    try {
        await mkdir(path.join(mappedRoot, 'repo-c'));
        setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", '/host/base');
        setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", mappedRoot);
        const res = await request(buildApp()).get('/ingest/dirs');
        assert.equal(res.status, 200);
        assert.equal(res.body.base, '/host/base');
        assert.equal(res.body.path, '/host/base');
        assert.deepEqual(res.body.dirs, ['repo-c']);
    }
    finally {
        await rm(mappedRoot, { recursive: true, force: true });
    }
});
