import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveSharedExecutionContext } from '../../workingFolders/executionContext.js';
import { knownRepositoryPathsAvailable, resolveWorkingFolderWorkingDirectory, validateRequestedWorkingFolder, } from '../../workingFolders/state.js';
describe('resolveWorkingFolderWorkingDirectory', () => {
    it('rejects relative working_folder inputs', async () => {
        await assert.rejects(resolveWorkingFolderWorkingDirectory('relative/path'), (err: unknown) => Boolean(err &&
            typeof err === 'object' &&
            (err as {
                code?: unknown;
            }).code === 'WORKING_FOLDER_INVALID'));
    });
    it('returns mapped path when mapping is possible and the mapped directory exists', async () => {
        if (process.platform === 'win32')
            return;
        const snapshot = {
            CODEINFO_HOST_INGEST_DIR: process.env.CODEINFO_HOST_INGEST_DIR,
            CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
            CODEX_WORKDIR: process.env.CODEX_WORKDIR,
        };
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-working-folder-'));
        const hostIngestDir = path.join(tmp, 'host', 'base');
        const codexWorkdir = path.join(tmp, 'data');
        try {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", hostIngestDir);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", codexWorkdir);
            clearScopedTestEnvValue("CODEX_WORKDIR");
            const workingFolder = path.join(hostIngestDir, 'repo', 'sub');
            const expectedMapped = path.join(codexWorkdir, 'repo', 'sub');
            await fs.mkdir(expectedMapped, { recursive: true });
            const resolved = await resolveSharedExecutionContext({
                workingFolder,
            });
            assert.equal(resolved.selectedRepositoryPath, expectedMapped);
            assert.equal(resolved.workingDirectoryOverride, expectedMapped);
            assert.deepEqual(resolved.runtime, {
                workingFolder: expectedMapped,
                lookupSummary: {
                    selectedRepositoryPath: expectedMapped,
                    fallbackUsed: false,
                    workingRepositoryAvailable: true,
                },
            });
        }
        finally {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", snapshot.CODEINFO_HOST_INGEST_DIR);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", snapshot.CODEINFO_CODEX_WORKDIR);
            setScopedTestEnvValue("CODEX_WORKDIR", snapshot.CODEX_WORKDIR);
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
    it('returns the literal path when mapping is not possible but the literal directory exists', async () => {
        if (process.platform === 'win32')
            return;
        const snapshot = {
            CODEINFO_HOST_INGEST_DIR: process.env.CODEINFO_HOST_INGEST_DIR,
            CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
            CODEX_WORKDIR: process.env.CODEX_WORKDIR,
        };
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-working-folder-'));
        const hostIngestDir = path.join(tmp, 'host', 'base');
        const codexWorkdir = path.join(tmp, 'data');
        try {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", hostIngestDir);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", codexWorkdir);
            clearScopedTestEnvValue("CODEX_WORKDIR");
            const workingFolder = path.join(tmp, 'some', 'literal', 'dir');
            await fs.mkdir(workingFolder, { recursive: true });
            const resolved = await resolveSharedExecutionContext({
                workingFolder,
            });
            assert.equal(resolved.selectedRepositoryPath, workingFolder);
            assert.equal(resolved.workingDirectoryOverride, workingFolder);
            assert.deepEqual(resolved.runtime, {
                workingFolder,
                lookupSummary: {
                    selectedRepositoryPath: workingFolder,
                    fallbackUsed: false,
                    workingRepositoryAvailable: true,
                },
            });
        }
        finally {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", snapshot.CODEINFO_HOST_INGEST_DIR);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", snapshot.CODEINFO_CODEX_WORKDIR);
            setScopedTestEnvValue("CODEX_WORKDIR", snapshot.CODEX_WORKDIR);
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
    it('throws WORKING_FOLDER_NOT_FOUND when neither mapped nor literal directory exists', async () => {
        if (process.platform === 'win32')
            return;
        const snapshot = {
            CODEINFO_HOST_INGEST_DIR: process.env.CODEINFO_HOST_INGEST_DIR,
            CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
            CODEX_WORKDIR: process.env.CODEX_WORKDIR,
        };
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-working-folder-'));
        const hostIngestDir = path.join(tmp, 'host', 'base');
        const codexWorkdir = path.join(tmp, 'data');
        try {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", hostIngestDir);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", codexWorkdir);
            clearScopedTestEnvValue("CODEX_WORKDIR");
            const workingFolder = path.join(hostIngestDir, 'repo', 'missing');
            await assert.rejects(resolveWorkingFolderWorkingDirectory(workingFolder), (err: unknown) => Boolean(err &&
                typeof err === 'object' &&
                (err as {
                    code?: unknown;
                }).code === 'WORKING_FOLDER_NOT_FOUND'));
        }
        finally {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", snapshot.CODEINFO_HOST_INGEST_DIR);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", snapshot.CODEINFO_CODEX_WORKDIR);
            setScopedTestEnvValue("CODEX_WORKDIR", snapshot.CODEX_WORKDIR);
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
    it('uses the shared default execution root instead of process cwd when no working_folder is selected', async () => {
        const snapshot = {
            CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
            CODEX_WORKDIR: process.env.CODEX_WORKDIR,
        };
        try {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", '/mounted/default-root');
            clearScopedTestEnvValue("CODEX_WORKDIR");
            const resolved = await resolveSharedExecutionContext({});
            assert.equal(resolved.defaultExecutionRoot, '/mounted/default-root');
            assert.equal(resolved.selectedRepositoryPath, '/mounted/default-root');
            assert.equal(resolved.workingDirectoryOverride, '/mounted/default-root');
            assert.deepEqual(resolved.runtime, {
                lookupSummary: {
                    selectedRepositoryPath: '/mounted/default-root',
                    fallbackUsed: true,
                    workingRepositoryAvailable: false,
                },
            });
            assert.notEqual(resolved.workingDirectoryOverride, process.cwd());
        }
        finally {
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", snapshot.CODEINFO_CODEX_WORKDIR);
            setScopedTestEnvValue("CODEX_WORKDIR", snapshot.CODEX_WORKDIR);
        }
    });
    it('accepts the mounted local codeinfo root identity when validating requested working folders', async () => {
        if (process.platform === 'win32')
            return;
        const snapshot = {
            CODEINFO_AGENT_HOME: process.env.CODEINFO_AGENT_HOME,
            CODEINFO_CODEX_AGENT_HOME: process.env.CODEINFO_CODEX_AGENT_HOME,
            CODEINFO_HOST_INGEST_DIR: process.env.CODEINFO_HOST_INGEST_DIR,
            CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
            CODEX_WORKDIR: process.env.CODEX_WORKDIR,
        };
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-working-folder-local-repo-'));
        const hostIngestDir = path.join(tmp, 'host');
        const codeInfoRoot = path.join(hostIngestDir, 'codeinfo-root');
        const codexWorkdir = path.join(tmp, 'data');
        const mappedWorkingFolder = path.join(codexWorkdir, 'codeinfo-root');
        try {
            setScopedTestEnvValue("CODEINFO_AGENT_HOME", path.join(codeInfoRoot, 'codeinfo_agents'));
            clearScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME");
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", hostIngestDir);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", codexWorkdir);
            clearScopedTestEnvValue("CODEX_WORKDIR");
            await fs.mkdir(mappedWorkingFolder, { recursive: true });
            const resolved = await validateRequestedWorkingFolder({
                workingFolder: codeInfoRoot,
                knownRepositoryPathsState: knownRepositoryPathsAvailable([]),
            });
            assert.equal(resolved, mappedWorkingFolder);
        }
        finally {
            setScopedTestEnvValue("CODEINFO_AGENT_HOME", snapshot.CODEINFO_AGENT_HOME);
            setScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME", snapshot.CODEINFO_CODEX_AGENT_HOME);
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", snapshot.CODEINFO_HOST_INGEST_DIR);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", snapshot.CODEINFO_CODEX_WORKDIR);
            setScopedTestEnvValue("CODEX_WORKDIR", snapshot.CODEX_WORKDIR);
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
    it('rejects the mounted local execution root child path when validating requested working folders', async () => {
        if (process.platform === 'win32')
            return;
        const snapshot = {
            CODEINFO_HOST_INGEST_DIR: process.env.CODEINFO_HOST_INGEST_DIR,
            CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
            CODEX_WORKDIR: process.env.CODEX_WORKDIR,
        };
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-working-folder-execution-root-'));
        const hostIngestDir = path.join(tmp, 'host', 'base');
        const codexWorkdir = path.join(tmp, 'data');
        const workingFolder = path.join(hostIngestDir, 'codeinfo2', 'codeinfo2');
        const mappedWorkingFolder = path.join(codexWorkdir, 'codeinfo2', 'codeinfo2');
        try {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", hostIngestDir);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", codexWorkdir);
            clearScopedTestEnvValue("CODEX_WORKDIR");
            await fs.mkdir(mappedWorkingFolder, { recursive: true });
            await assert.rejects(validateRequestedWorkingFolder({
                workingFolder,
                knownRepositoryPathsState: knownRepositoryPathsAvailable([]),
            }), (error) => (error as {
                code?: string;
            }).code === 'WORKING_FOLDER_NOT_FOUND');
        }
        finally {
            setScopedTestEnvValue("CODEINFO_HOST_INGEST_DIR", snapshot.CODEINFO_HOST_INGEST_DIR);
            setScopedTestEnvValue("CODEINFO_CODEX_WORKDIR", snapshot.CODEINFO_CODEX_WORKDIR);
            setScopedTestEnvValue("CODEX_WORKDIR", snapshot.CODEX_WORKDIR);
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});
