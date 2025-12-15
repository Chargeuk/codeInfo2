import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { resolveWorkingFolderWorkingDirectory } from '../../agents/service.js';

describe('resolveWorkingFolderWorkingDirectory', () => {
  it('rejects relative working_folder inputs', async () => {
    await assert.rejects(
      resolveWorkingFolderWorkingDirectory('relative/path'),
      (err: unknown) =>
        Boolean(
          err &&
            typeof err === 'object' &&
            (err as { code?: unknown }).code === 'WORKING_FOLDER_INVALID',
        ),
    );
  });

  it('returns mapped path when mapping is possible and the mapped directory exists', async () => {
    if (process.platform === 'win32') return;

    const snapshot = {
      HOST_INGEST_DIR: process.env.HOST_INGEST_DIR,
      CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
      CODEX_WORKDIR: process.env.CODEX_WORKDIR,
    };

    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'agents-working-folder-'),
    );
    const hostIngestDir = path.join(tmp, 'host', 'base');
    const codexWorkdir = path.join(tmp, 'data');

    try {
      process.env.HOST_INGEST_DIR = hostIngestDir;
      process.env.CODEINFO_CODEX_WORKDIR = codexWorkdir;
      delete process.env.CODEX_WORKDIR;

      const workingFolder = path.join(hostIngestDir, 'repo', 'sub');
      const expectedMapped = path.join(codexWorkdir, 'repo', 'sub');
      await fs.mkdir(expectedMapped, { recursive: true });

      const resolved =
        await resolveWorkingFolderWorkingDirectory(workingFolder);
      assert.equal(resolved, expectedMapped);
    } finally {
      process.env.HOST_INGEST_DIR = snapshot.HOST_INGEST_DIR;
      process.env.CODEINFO_CODEX_WORKDIR = snapshot.CODEINFO_CODEX_WORKDIR;
      process.env.CODEX_WORKDIR = snapshot.CODEX_WORKDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns the literal path when mapping is not possible but the literal directory exists', async () => {
    if (process.platform === 'win32') return;

    const snapshot = {
      HOST_INGEST_DIR: process.env.HOST_INGEST_DIR,
      CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
      CODEX_WORKDIR: process.env.CODEX_WORKDIR,
    };

    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'agents-working-folder-'),
    );
    const hostIngestDir = path.join(tmp, 'host', 'base');
    const codexWorkdir = path.join(tmp, 'data');

    try {
      process.env.HOST_INGEST_DIR = hostIngestDir;
      process.env.CODEINFO_CODEX_WORKDIR = codexWorkdir;
      delete process.env.CODEX_WORKDIR;

      const workingFolder = path.join(tmp, 'some', 'literal', 'dir');
      await fs.mkdir(workingFolder, { recursive: true });

      const resolved =
        await resolveWorkingFolderWorkingDirectory(workingFolder);
      assert.equal(resolved, workingFolder);
    } finally {
      process.env.HOST_INGEST_DIR = snapshot.HOST_INGEST_DIR;
      process.env.CODEINFO_CODEX_WORKDIR = snapshot.CODEINFO_CODEX_WORKDIR;
      process.env.CODEX_WORKDIR = snapshot.CODEX_WORKDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws WORKING_FOLDER_NOT_FOUND when neither mapped nor literal directory exists', async () => {
    if (process.platform === 'win32') return;

    const snapshot = {
      HOST_INGEST_DIR: process.env.HOST_INGEST_DIR,
      CODEINFO_CODEX_WORKDIR: process.env.CODEINFO_CODEX_WORKDIR,
      CODEX_WORKDIR: process.env.CODEX_WORKDIR,
    };

    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'agents-working-folder-'),
    );
    const hostIngestDir = path.join(tmp, 'host', 'base');
    const codexWorkdir = path.join(tmp, 'data');

    try {
      process.env.HOST_INGEST_DIR = hostIngestDir;
      process.env.CODEINFO_CODEX_WORKDIR = codexWorkdir;
      delete process.env.CODEX_WORKDIR;

      const workingFolder = path.join(hostIngestDir, 'repo', 'missing');

      await assert.rejects(
        resolveWorkingFolderWorkingDirectory(workingFolder),
        (err: unknown) =>
          Boolean(
            err &&
              typeof err === 'object' &&
              (err as { code?: unknown }).code === 'WORKING_FOLDER_NOT_FOUND',
          ),
      );
    } finally {
      process.env.HOST_INGEST_DIR = snapshot.HOST_INGEST_DIR;
      process.env.CODEINFO_CODEX_WORKDIR = snapshot.CODEINFO_CODEX_WORKDIR;
      process.env.CODEX_WORKDIR = snapshot.CODEX_WORKDIR;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
