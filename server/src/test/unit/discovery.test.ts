import fs from 'fs/promises';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import os from 'os';
import path from 'path';
import { discoverFiles, resolveConfig } from '../../ingest/index.js';
const execFile = promisify(execFileCb);

const makeTempDir = async (t: TestContext): Promise<string> => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-'));
    t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));
    return tmpDir;
};

test('skips excluded directories and files', async (t) => {
    const tmpDir = await makeTempDir(t);
    const srcDir = path.join(tmpDir, 'src');
    const nodeModules = path.join(tmpDir, 'node_modules');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(nodeModules, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'file.ts'), 'export const a = 1;');
    await fs.writeFile(path.join(nodeModules, 'junk.js'), 'console.log("x")');
    const { files } = await discoverFiles(tmpDir, resolveConfig());
    assert.equal(files.length, 1);
    assert.equal(files[0].relPath, path.join('src', 'file.ts'));
    assert.equal(files[0].size, Buffer.byteLength('export const a = 1;', 'utf8'));
});
test('respects env include overrides', async (t) => {
    const tmpDir = await makeTempDir(t);
    setScopedTestEnvValue("CODEINFO_INGEST_INCLUDE", 'md');
    const docPath = path.join(tmpDir, 'README.md');
    await fs.writeFile(docPath, '# hello');
    const { files } = await discoverFiles(tmpDir);
    assert.equal(files.length, 1);
    assert.equal(files[0].relPath, 'README.md');
    assert.equal(files[0].size, Buffer.byteLength('# hello', 'utf8'));
});
test('git repo uses tracked files only', async (t) => {
    const tmpDir = await makeTempDir(t);
    const repo = tmpDir;
    await fs.writeFile(path.join(repo, 'tracked.ts'), 'export const t = 1;');
    await fs.writeFile(path.join(repo, 'ignored.log'), 'log');
    setScopedTestEnvValue("CODEINFO_INGEST_INCLUDE", 'ts');
    await execFile('git', ['-C', repo, 'init']);
    await execFile('git', ['-C', repo, 'add', 'tracked.ts']);
    await execFile('git', [
        '-c',
        'user.name=CodeInfo Test',
        '-c',
        'user.email=codeinfo-test@example.invalid',
        '-C',
        repo,
        'commit',
        '-m',
        'add tracked',
        '--allow-empty',
    ]);
    const { files } = await discoverFiles(repo);
    assert.equal(files.length, 1);
    assert.equal(files[0].relPath, 'tracked.ts');
    assert.equal(files[0].size, Buffer.byteLength('export const t = 1;', 'utf8'));
});
test('ignores an invalid git marker and falls back to walkDir', async (t) => {
    const tmpDir = await makeTempDir(t);
    const repo = tmpDir;
    await fs.mkdir(path.join(repo, '.git'));
    await fs.writeFile(path.join(repo, 'fallback.ts'), 'export const f = 1;');
    setScopedTestEnvValue("CODEINFO_INGEST_INCLUDE", 'ts');
    const { files } = await discoverFiles(repo);
    assert.equal(files.length, 1);
    assert.equal(files[0].relPath, 'fallback.ts');
    assert.equal(files[0].size, Buffer.byteLength('export const f = 1;', 'utf8'));
});
