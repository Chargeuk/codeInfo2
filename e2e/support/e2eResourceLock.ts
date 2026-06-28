import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeLockName(name: string) {
  return name.replace(/[^a-z0-9._-]+/giu, '-').toLowerCase();
}

export async function acquireE2eResourceLock(
  name: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 240_000;
  const pollMs = options.pollMs ?? 500;
  const lockDir = path.join(
    os.tmpdir(),
    `codeinfo2-e2e-lock-${sanitizeLockName(name)}`,
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fs.mkdir(lockDir);
      return async () => {
        await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(`timed out waiting for e2e resource lock "${name}"`);
}
