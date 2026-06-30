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

type LockSnapshot = {
  metadata: Partial<LockMetadata> | null;
  metadataMissing: boolean;
  mtimeMs: number;
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

async function readLockSnapshot(lockDir: string): Promise<LockSnapshot | null> {
  let metadata: Partial<LockMetadata> | null = null;
  let metadataMissing = false;

  try {
    const metadataRaw = await fs.readFile(
      path.join(lockDir, LOCK_METADATA_FILE),
      'utf8',
    );
    try {
      metadata = JSON.parse(metadataRaw) as Partial<LockMetadata>;
    } catch (error) {
      if (error instanceof SyntaxError) {
        metadata = null;
      } else {
        throw error;
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      metadataMissing = true;
    } else {
      throw error;
    }
  }

  try {
    const stats = await fs.stat(lockDir);
    return {
      metadata,
      metadataMissing,
      mtimeMs: stats.mtimeMs,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function describeReclaimableLock(lockDir: string, staleAfterMs: number) {
  const snapshot = await readLockSnapshot(lockDir);
  if (!snapshot) {
    return null;
  }

  if (
    typeof snapshot.metadata?.pid === 'number' &&
    Number.isFinite(snapshot.metadata.pid) &&
    snapshot.metadata.pid > 0 &&
    !isProcessAlive(snapshot.metadata.pid)
  ) {
    return snapshot;
  }

  if (Date.now() - snapshot.mtimeMs > staleAfterMs) {
    return snapshot;
  }

  return null;
}

function sameMetadata(
  left: Partial<LockMetadata> | null,
  right: Partial<LockMetadata> | null,
) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return left.pid === right.pid && left.createdAtMs === right.createdAtMs;
}

async function reclaimIfUnchanged(lockDir: string, snapshot: LockSnapshot) {
  const current = await readLockSnapshot(lockDir);
  if (!current) {
    return false;
  }

  if (
    current.metadataMissing !== snapshot.metadataMissing ||
    !sameMetadata(current.metadata, snapshot.metadata) ||
    current.mtimeMs !== snapshot.mtimeMs
  ) {
    return false;
  }

  await fs.rm(lockDir, { recursive: true, force: true });
  return true;
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

      const staleSnapshot = await describeReclaimableLock(
        lockDir,
        staleAfterMs,
      );
      if (staleSnapshot && (await reclaimIfUnchanged(lockDir, staleSnapshot))) {
        continue;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(`timed out waiting for e2e resource lock "${name}"`);
}
