import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type CopilotSeedArtifactName =
  | 'config.json'
  | 'settings.json'
  | 'session-state';

export type CopilotSeedImportStatus =
  | 'seed_missing'
  | 'seed_skipped_runtime_already_initialized'
  | 'seed_applied'
  | 'seed_copy_failed';

export type CopilotSeedArtifactResult = {
  artifact: CopilotSeedArtifactName;
  action: 'copied' | 'skipped_existing_runtime' | 'skipped_missing_seed';
  sourcePath: string;
  targetPath: string;
};

export type CopilotSeedImportResult = {
  status: CopilotSeedImportStatus;
  runtimeHome: string;
  seedHome?: string;
  copiedArtifacts: CopilotSeedArtifactName[];
  skippedArtifacts: CopilotSeedArtifactResult[];
  error?: string;
};

type CopilotSeedArtifactDescriptor = {
  artifact: CopilotSeedArtifactName;
  relativePath: string;
  kind: 'file' | 'directory';
};

type RuntimeOwnership = {
  uid: number;
  gid: number;
};

const COPILOT_SEED_ARTIFACTS: CopilotSeedArtifactDescriptor[] = [
  {
    artifact: 'config.json',
    relativePath: 'config.json',
    kind: 'file',
  },
  {
    artifact: 'settings.json',
    relativePath: 'settings.json',
    kind: 'file',
  },
  {
    artifact: 'session-state',
    relativePath: 'session-state',
    kind: 'directory',
  },
];

const COPILOT_RUNTIME_FILE_MODE = 0o600;
const COPILOT_RUNTIME_DIRECTORY_MODE = 0o700;

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupPath(targetPath: string): Promise<void> {
  await fs.promises.rm(targetPath, {
    force: true,
    recursive: true,
  });
}

function parseNumericId(value: string | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

function resolveRuntimeOwnership(
  env: NodeJS.ProcessEnv | undefined,
): RuntimeOwnership | undefined {
  const uid = parseNumericId(env?.CODEINFO_RUNTIME_UID);
  const gid = parseNumericId(env?.CODEINFO_RUNTIME_GID);
  if (uid === undefined || gid === undefined) {
    return undefined;
  }
  return { uid, gid };
}

async function normalizeArtifactAccess(params: {
  targetPath: string;
  kind: 'file' | 'directory';
  runtimeOwnership?: RuntimeOwnership;
}): Promise<void> {
  const stats = await fs.promises.lstat(params.targetPath);

  if (
    params.runtimeOwnership &&
    (stats.uid !== params.runtimeOwnership.uid ||
      stats.gid !== params.runtimeOwnership.gid)
  ) {
    await fs.promises.chown(
      params.targetPath,
      params.runtimeOwnership.uid,
      params.runtimeOwnership.gid,
    );
  }

  if (params.kind === 'directory') {
    await fs.promises.chmod(params.targetPath, COPILOT_RUNTIME_DIRECTORY_MODE);
    const entries = await fs.promises.readdir(params.targetPath, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const childPath = path.join(params.targetPath, entry.name);
      if (entry.isDirectory()) {
        await normalizeArtifactAccess({
          targetPath: childPath,
          kind: 'directory',
          runtimeOwnership: params.runtimeOwnership,
        });
        continue;
      }
      if (entry.isFile()) {
        await normalizeArtifactAccess({
          targetPath: childPath,
          kind: 'file',
          runtimeOwnership: params.runtimeOwnership,
        });
      }
    }
    return;
  }

  await fs.promises.chmod(params.targetPath, COPILOT_RUNTIME_FILE_MODE);
}

async function copyArtifactAtomically(params: {
  sourcePath: string;
  targetPath: string;
  kind: 'file' | 'directory';
}): Promise<void> {
  const targetParent = path.dirname(params.targetPath);
  await fs.promises.mkdir(targetParent, { recursive: true });

  const tempPath = `${params.targetPath}.codeinfo-seed.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;

  try {
    if (params.kind === 'directory') {
      await fs.promises.cp(params.sourcePath, tempPath, { recursive: true });
    } else {
      await fs.promises.copyFile(params.sourcePath, tempPath);
    }
    await fs.promises.rename(tempPath, params.targetPath);
  } finally {
    await cleanupPath(tempPath).catch(() => {});
  }
}

export async function importCopilotSeedIntoRuntimeHome(params: {
  runtimeHome: string;
  seedHome?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CopilotSeedImportResult> {
  const runtimeHome = path.resolve(params.runtimeHome);
  const seedHomeInput =
    trimToUndefined(params.seedHome) ??
    trimToUndefined(params.env?.CODEINFO_COPILOT_SEED_HOME);
  const seedHome = seedHomeInput ? path.resolve(seedHomeInput) : undefined;
  const runtimeOwnership = resolveRuntimeOwnership(params.env);

  try {
    await fs.promises.mkdir(runtimeHome, { recursive: true });
  } catch (error) {
    return {
      status: 'seed_copy_failed',
      runtimeHome,
      seedHome,
      copiedArtifacts: [],
      skippedArtifacts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!seedHome || !(await pathExists(seedHome))) {
    return {
      status: 'seed_missing',
      runtimeHome,
      seedHome,
      copiedArtifacts: [],
      skippedArtifacts: [],
    };
  }

  const copiedArtifacts: CopilotSeedArtifactName[] = [];
  const skippedArtifacts: CopilotSeedArtifactResult[] = [];

  try {
    for (const descriptor of COPILOT_SEED_ARTIFACTS) {
      const sourcePath = path.join(seedHome, descriptor.relativePath);
      const targetPath = path.join(runtimeHome, descriptor.relativePath);

      if (await pathExists(targetPath)) {
        await normalizeArtifactAccess({
          targetPath,
          kind: descriptor.kind,
          runtimeOwnership,
        });
        skippedArtifacts.push({
          artifact: descriptor.artifact,
          action: 'skipped_existing_runtime',
          sourcePath,
          targetPath,
        });
        continue;
      }

      if (!(await pathExists(sourcePath))) {
        skippedArtifacts.push({
          artifact: descriptor.artifact,
          action: 'skipped_missing_seed',
          sourcePath,
          targetPath,
        });
        continue;
      }

      await copyArtifactAtomically({
        sourcePath,
        targetPath,
        kind: descriptor.kind,
      });
      await normalizeArtifactAccess({
        targetPath,
        kind: descriptor.kind,
        runtimeOwnership,
      });
      copiedArtifacts.push(descriptor.artifact);
    }
  } catch (error) {
    return {
      status: 'seed_copy_failed',
      runtimeHome,
      seedHome,
      copiedArtifacts,
      skippedArtifacts,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    status:
      copiedArtifacts.length > 0
        ? 'seed_applied'
        : 'seed_skipped_runtime_already_initialized',
    runtimeHome,
    seedHome,
    copiedArtifacts,
    skippedArtifacts,
  };
}

async function runCli(): Promise<void> {
  const result = await importCopilotSeedIntoRuntimeHome({
    runtimeHome:
      process.argv[2] ?? process.env.CODEINFO_COPILOT_HOME ?? '/app/copilot',
    seedHome: process.argv[3],
    env: process.env,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (invokedPath && import.meta.url === invokedPath) {
  await runCli();
}
