import fs from 'fs/promises';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { afterEach, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';
import os from 'os';
import path from 'path';
import { discoverFiles, resolveConfig } from '../../ingest/index.js';
const execFile = promisify(execFileCb);
let tmpDir: string;
let prevInclude: string | undefined;
let prevExclude: string | undefined;
beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-'));
    prevInclude = process.env.CODEINFO_INGEST_INCLUDE;
    prevExclude = process.env.CODEINFO_INGEST_EXCLUDE;
});
afterEach(async () => {
    setScopedTestEnvValue("CODEINFO_INGEST_INCLUDE", prevInclude);
    setScopedTestEnvValue("CODEINFO_INGEST_EXCLUDE", prevExclude);
    await fs.rm(tmpDir, { recursive: true, force: true });
});
test('skips excluded directories and files', async () => {
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
test('respects env include overrides', async () => {
    setScopedTestEnvValue("CODEINFO_INGEST_INCLUDE", 'md');
    const docPath = path.join(tmpDir, 'README.md');
    await fs.writeFile(docPath, '# hello');
    const { files } = await discoverFiles(tmpDir);
    assert.equal(files.length, 1);
    assert.equal(files[0].relPath, 'README.md');
    assert.equal(files[0].size, Buffer.byteLength('# hello', 'utf8'));
});
test('git repo uses tracked files only', async () => {
    const repo = tmpDir;
    await fs.writeFile(path.join(repo, 'tracked.ts'), 'export const t = 1;');
    await fs.writeFile(path.join(repo, 'ignored.log'), 'log');
    setScopedTestEnvValue("CODEINFO_INGEST_INCLUDE", 'ts');
    await execFile('git', ['-C', repo, 'init']);
    await execFile('git', ['-C', repo, 'add', 'tracked.ts']);
    await execFile('git', [
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
test('falls back to walkDir when git ls-files fails', async () => {
    const repo = tmpDir;
    await fs.mkdir(path.join(repo, '.git'));
    await fs.writeFile(path.join(repo, 'fallback.ts'), 'export const f = 1;');
    setScopedTestEnvValue("CODEINFO_INGEST_INCLUDE", 'ts');
    const { files } = await discoverFiles(repo);
    assert.equal(files.length, 1);
    assert.equal(files[0].relPath, 'fallback.ts');
    assert.equal(files[0].size, Buffer.byteLength('export const f = 1;', 'utf8'));
});
