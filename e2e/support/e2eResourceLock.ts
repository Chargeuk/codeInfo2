import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const LOCK_METADATA_FILE = 'owner.json';

function sanitizeLockName(name: string) {
  return name.replace(/[^a-z0-9._-]+/giu, '-').toLowerCase();
}

type LockMetadata = {
  pid: number;
  createdAtMs: number;
};

async function writeLockMetadata(lockDir: string) {
  const metadata: LockMetadata = {
    pid: process.pid,
    createdAtMs: Date.now(),
  };
  await fs.writeFile(
    path.join(lockDir, LOCK_METADATA_FILE),
    JSON.stringify(metadata),
    'utf8',
  );
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

async function shouldReclaimStaleLock(lockDir: string, staleAfterMs: number) {
  try {
    const metadataRaw = await fs.readFile(
      path.join(lockDir, LOCK_METADATA_FILE),
      'utf8',
    );
    let metadata: Partial<LockMetadata> | null = null;
    try {
      metadata = JSON.parse(metadataRaw) as Partial<LockMetadata>;
    } catch (error) {
      if (error instanceof SyntaxError) {
        metadata = null;
      } else {
        throw error;
      }
    }
    if (
      typeof metadata?.pid === 'number' &&
      Number.isFinite(metadata.pid) &&
      metadata.pid > 0
    ) {
      return !isProcessAlive(metadata.pid);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    const stats = await fs.stat(lockDir);
    return Date.now() - stats.mtimeMs > staleAfterMs;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function acquireE2eResourceLock(
  name: string,
  options: { timeoutMs?: number; pollMs?: number; staleAfterMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 240_000;
  const pollMs = options.pollMs ?? 500;
  const staleAfterMs = options.staleAfterMs ?? 30_000;
  const lockDir = path.join(
    os.tmpdir(),
    `codeinfo2-e2e-lock-${sanitizeLockName(name)}`,
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fs.mkdir(lockDir);
      await writeLockMetadata(lockDir);
      return async () => {
        await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }

      if (await shouldReclaimStaleLock(lockDir, staleAfterMs)) {
        await fs.rm(lockDir, { recursive: true, force: true });
        continue;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(`timed out waiting for e2e resource lock "${name}"`);
}
