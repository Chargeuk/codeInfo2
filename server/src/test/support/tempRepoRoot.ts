import fs from 'fs/promises';
import os from 'os';
import path from 'path';

function resolveTempRootBase() {
  const configuredRoot = process.env.CODEINFO_CODEX_WORKDIR?.trim();
  if (!configuredRoot || configuredRoot.includes('$')) {
    return os.tmpdir();
  }

  return path.isAbsolute(configuredRoot) ? configuredRoot : os.tmpdir();
}

export async function createTempRepoRoot(prefix: string) {
  return fs.mkdtemp(path.join(resolveTempRootBase(), prefix));
}
