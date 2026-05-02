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

type RuntimeArtifactState = {
  descriptor: CopilotSeedArtifactDescriptor;
  sourcePath: string;
  targetPath: string;
  targetReady: boolean;
};

type RuntimeOwnership = {
  uid: number;
  gid: number;
};

type StagedArtifactDescriptor = CopilotSeedArtifactDescriptor & {
  sourcePath: string;
  targetPath: string;
  stagedPath: string;
};

type CreatedRuntimeArtifact = {
  targetPath: string;
  stagedPath: string;
  kind: 'file' | 'directory';
};

type CopilotSeedBootstrapHooks = {
  beforePublishArtifact?: (params: {
    artifact: CopilotSeedArtifactName;
    stagedPath: string;
    targetPath: string;
    kind: 'file' | 'directory';
  }) => Promise<void> | void;
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
const defaultCopilotSeedBootstrapHooks: CopilotSeedBootstrapHooks = {};
const copilotSeedBootstrapHooks: CopilotSeedBootstrapHooks = {
  ...defaultCopilotSeedBootstrapHooks,
};

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readPathType(
  targetPath: string,
): Promise<'missing' | 'directory' | 'other'> {
  try {
    const stats = await fs.promises.stat(targetPath);
    return stats.isDirectory() ? 'directory' : 'other';
  } catch {
    return 'missing';
  }
}

async function cleanupPath(targetPath: string): Promise<void> {
  await fs.promises.rm(targetPath, {
    force: true,
    recursive: true,
  });
}

export function __setCopilotSeedBootstrapHooksForTests(
  overrides: Partial<CopilotSeedBootstrapHooks>,
) {
  Object.assign(copilotSeedBootstrapHooks, overrides);
}

export function __resetCopilotSeedBootstrapHooksForTests() {
  Object.assign(copilotSeedBootstrapHooks, defaultCopilotSeedBootstrapHooks);
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

function isAlreadyInitializedRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EXDEV';
}

async function stageArtifactCopy(params: {
  sourcePath: string;
  stagedPath: string;
  kind: 'file' | 'directory';
}): Promise<void> {
  const stageParent = path.dirname(params.stagedPath);
  await fs.promises.mkdir(stageParent, { recursive: true });

  if (params.kind === 'directory') {
    await fs.promises.cp(params.sourcePath, params.stagedPath, {
      recursive: true,
    });
    return;
  }

  await fs.promises.copyFile(params.sourcePath, params.stagedPath);
}

async function assertSeedArtifactTreeHasNoSymlinks(
  targetPath: string,
): Promise<void> {
  const stats = await fs.promises.lstat(targetPath);
  if (stats.isSymbolicLink()) {
    throw new Error(`copilot seed artifact cannot be a symlink: ${targetPath}`);
  }
  if (!stats.isDirectory()) {
    return;
  }

  const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        `copilot seed artifact cannot be a symlink: ${path.join(
          targetPath,
          entry.name,
        )}`,
      );
    }
    if (entry.isDirectory()) {
      await assertSeedArtifactTreeHasNoSymlinks(
        path.join(targetPath, entry.name),
      );
    }
  }
}

async function publishStagedArtifact(params: {
  stagedPath: string;
  targetPath: string;
  kind: 'file' | 'directory';
}): Promise<'copied' | 'skipped_existing_runtime'> {
  if (params.kind === 'directory') {
    try {
      await fs.promises.rename(params.stagedPath, params.targetPath);
      return 'copied';
    } catch (error) {
      if (
        isAlreadyInitializedRenameError(error) ||
        (await pathExists(params.targetPath))
      ) {
        return 'skipped_existing_runtime';
      }
      throw error;
    }
  }

  const publishTempPath = `${params.targetPath}.codeinfo-publish.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  try {
    await fs.promises.copyFile(params.stagedPath, publishTempPath);
    await fs.promises.link(publishTempPath, params.targetPath);
    return 'copied';
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
      return 'skipped_existing_runtime';
    }
    throw error;
  } finally {
    await cleanupPath(publishTempPath).catch(() => {});
  }
}

async function collectRuntimeInitializedArtifacts(
  runtimeHome: string,
  runtimeOwnership?: RuntimeOwnership,
) {
  const runtimeArtifacts: RuntimeArtifactState[] = [];
  for (const descriptor of COPILOT_SEED_ARTIFACTS) {
    const targetPath = path.join(runtimeHome, descriptor.relativePath);
    const targetType = await readPathType(targetPath);
    if (targetType !== 'missing') {
      await normalizeArtifactAccess({
        targetPath,
        kind: descriptor.kind,
        runtimeOwnership,
      }).catch(() => {});
    }
    runtimeArtifacts.push({
      descriptor,
      sourcePath: '',
      targetPath,
      targetReady: await isArtifactRuntimeReady({
        targetPath,
        descriptor,
      }),
    });
  }
  return runtimeArtifacts;
}

async function directoryHasEntries(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function isArtifactRuntimeReady(params: {
  targetPath: string;
  descriptor: CopilotSeedArtifactDescriptor;
}): Promise<boolean> {
  if (params.descriptor.kind === 'file') {
    return pathExists(params.targetPath);
  }

  const targetType = await readPathType(params.targetPath);
  if (targetType !== 'directory') {
    return false;
  }

  if (await pathExists(path.join(params.targetPath, 'session.json'))) {
    return true;
  }

  return directoryHasEntries(params.targetPath);
}

async function rollbackCreatedArtifacts(
  artifacts: CreatedRuntimeArtifact[],
): Promise<void> {
  for (const artifact of [...artifacts].reverse()) {
    if (artifact.kind === 'file') {
      try {
        const [targetContents, stagedContents] = await Promise.all([
          fs.promises.readFile(artifact.targetPath),
          fs.promises.readFile(artifact.stagedPath),
        ]);
        if (!targetContents.equals(stagedContents)) {
          continue;
        }
      } catch {
        continue;
      }
    }
    await cleanupPath(artifact.targetPath).catch(() => {});
  }
}

async function mergeStagedDirectoryIntoRuntime(params: {
  stagedPath: string;
  targetPath: string;
  runtimeOwnership?: RuntimeOwnership;
  createdTargets: CreatedRuntimeArtifact[];
}): Promise<'copied' | 'skipped_existing_runtime'> {
  const targetType = await readPathType(params.targetPath);
  if (targetType === 'missing') {
    try {
      const publishResult = await publishStagedArtifact({
        stagedPath: params.stagedPath,
        targetPath: params.targetPath,
        kind: 'directory',
      });
      if (publishResult === 'copied') {
        params.createdTargets.push({
          targetPath: params.targetPath,
          stagedPath: params.stagedPath,
          kind: 'directory',
        });
        await normalizeArtifactAccess({
          targetPath: params.targetPath,
          kind: 'directory',
          runtimeOwnership: params.runtimeOwnership,
        });
      }
      return publishResult;
    } catch (error) {
      if (!isCrossDeviceRenameError(error)) {
        throw error;
      }

      try {
        await fs.promises.mkdir(params.targetPath);
      } catch (mkdirError) {
        if (
          (mkdirError as NodeJS.ErrnoException | undefined)?.code ===
            'EEXIST' ||
          (await pathExists(params.targetPath))
        ) {
          return 'skipped_existing_runtime';
        }
        throw mkdirError;
      }

      params.createdTargets.push({
        targetPath: params.targetPath,
        stagedPath: params.stagedPath,
        kind: 'directory',
      });

      const publishResult = await mergeStagedDirectoryIntoRuntime({
        stagedPath: params.stagedPath,
        targetPath: params.targetPath,
        runtimeOwnership: params.runtimeOwnership,
        createdTargets: params.createdTargets,
      });
      await normalizeArtifactAccess({
        targetPath: params.targetPath,
        kind: 'directory',
        runtimeOwnership: params.runtimeOwnership,
      });
      return publishResult;
    }
  }

  if (targetType !== 'directory') {
    throw new Error(
      `copilot runtime artifact path is not a directory: ${params.targetPath}`,
    );
  }

  const stagedEntries = await fs.promises.readdir(params.stagedPath, {
    withFileTypes: true,
  });
  let copiedAny = false;

  for (const entry of stagedEntries) {
    const childStagedPath = path.join(params.stagedPath, entry.name);
    const childTargetPath = path.join(params.targetPath, entry.name);

    if (entry.isDirectory()) {
      const childResult = await mergeStagedDirectoryIntoRuntime({
        stagedPath: childStagedPath,
        targetPath: childTargetPath,
        runtimeOwnership: params.runtimeOwnership,
        createdTargets: params.createdTargets,
      });
      copiedAny = copiedAny || childResult === 'copied';
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const childResult = await publishStagedArtifact({
      stagedPath: childStagedPath,
      targetPath: childTargetPath,
      kind: 'file',
    });
    if (childResult !== 'copied') {
      continue;
    }
    copiedAny = true;
    params.createdTargets.push({
      targetPath: childTargetPath,
      stagedPath: childStagedPath,
      kind: 'file',
    });
    await normalizeArtifactAccess({
      targetPath: childTargetPath,
      kind: 'file',
      runtimeOwnership: params.runtimeOwnership,
    });
  }

  await normalizeArtifactAccess({
    targetPath: params.targetPath,
    kind: 'directory',
    runtimeOwnership: params.runtimeOwnership,
  });
  return copiedAny ? 'copied' : 'skipped_existing_runtime';
}

function toSkippedExistingRuntimeArtifact(
  artifact: RuntimeArtifactState,
): CopilotSeedArtifactResult {
  return {
    artifact: artifact.descriptor.artifact,
    action: 'skipped_existing_runtime',
    sourcePath: artifact.sourcePath,
    targetPath: artifact.targetPath,
  };
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

  if (!seedHome) {
    return {
      status: 'seed_missing',
      runtimeHome,
      seedHome,
      copiedArtifacts: [],
      skippedArtifacts: [],
    };
  }

  const seedHomeType = await readPathType(seedHome);
  if (seedHomeType === 'missing') {
    return {
      status: 'seed_missing',
      runtimeHome,
      seedHome,
      copiedArtifacts: [],
      skippedArtifacts: [],
    };
  }

  if (seedHomeType !== 'directory') {
    return {
      status: 'seed_copy_failed',
      runtimeHome,
      seedHome,
      copiedArtifacts: [],
      skippedArtifacts: [],
      error: `copilot seed home is not a directory: ${seedHome}`,
    };
  }

  const copiedArtifacts: CopilotSeedArtifactName[] = [];
  const skippedArtifacts: CopilotSeedArtifactResult[] = [];
  let stageRoot: string | undefined;
  const createdTargets: CreatedRuntimeArtifact[] = [];

  try {
    stageRoot = await fs.promises.mkdtemp(
      path.join(
        path.dirname(runtimeHome),
        `.copilot-seed-stage-${process.pid}-`,
      ),
    );
    const runtimeArtifacts = await collectRuntimeInitializedArtifacts(
      runtimeHome,
      runtimeOwnership,
    );
    if (runtimeArtifacts.every((artifact) => artifact.targetReady)) {
      for (const existingArtifact of runtimeArtifacts) {
        await normalizeArtifactAccess({
          targetPath: existingArtifact.targetPath,
          kind: existingArtifact.descriptor.kind,
          runtimeOwnership,
        });
        skippedArtifacts.push(
          toSkippedExistingRuntimeArtifact(existingArtifact),
        );
      }
      return {
        status: 'seed_skipped_runtime_already_initialized',
        runtimeHome,
        seedHome,
        copiedArtifacts: [],
        skippedArtifacts,
      };
    }

    const stagedArtifacts: StagedArtifactDescriptor[] = [];
    for (const descriptor of COPILOT_SEED_ARTIFACTS) {
      const sourcePath = path.join(seedHome, descriptor.relativePath);
      const targetPath = path.join(runtimeHome, descriptor.relativePath);

      if (!(await pathExists(sourcePath))) {
        skippedArtifacts.push({
          artifact: descriptor.artifact,
          action: 'skipped_missing_seed',
          sourcePath,
          targetPath,
        });
        continue;
      }

      await assertSeedArtifactTreeHasNoSymlinks(sourcePath);

      const stagedPath = path.join(stageRoot, descriptor.relativePath);
      await stageArtifactCopy({
        sourcePath,
        stagedPath,
        kind: descriptor.kind,
      });
      stagedArtifacts.push({
        ...descriptor,
        sourcePath,
        targetPath,
        stagedPath,
      });
    }

    for (const stagedArtifact of stagedArtifacts) {
      const preflightArtifact = runtimeArtifacts.find(
        (artifact) => artifact.descriptor.artifact === stagedArtifact.artifact,
      );
      if (preflightArtifact?.targetReady) {
        await normalizeArtifactAccess({
          targetPath: stagedArtifact.targetPath,
          kind: stagedArtifact.kind,
          runtimeOwnership,
        });
        skippedArtifacts.push({
          artifact: stagedArtifact.artifact,
          action: 'skipped_existing_runtime',
          sourcePath: stagedArtifact.sourcePath,
          targetPath: stagedArtifact.targetPath,
        });
        continue;
      }

      await copilotSeedBootstrapHooks.beforePublishArtifact?.({
        artifact: stagedArtifact.artifact,
        stagedPath: stagedArtifact.stagedPath,
        targetPath: stagedArtifact.targetPath,
        kind: stagedArtifact.kind,
      });

      const refreshedRuntimeArtifacts =
        await collectRuntimeInitializedArtifacts(runtimeHome, runtimeOwnership);
      if (refreshedRuntimeArtifacts.every((artifact) => artifact.targetReady)) {
        await rollbackCreatedArtifacts(createdTargets);
        for (const existingArtifact of refreshedRuntimeArtifacts) {
          await normalizeArtifactAccess({
            targetPath: existingArtifact.targetPath,
            kind: existingArtifact.descriptor.kind,
            runtimeOwnership,
          });
          skippedArtifacts.push(
            toSkippedExistingRuntimeArtifact(existingArtifact),
          );
        }
        return {
          status: 'seed_skipped_runtime_already_initialized',
          runtimeHome,
          seedHome,
          copiedArtifacts: [],
          skippedArtifacts,
        };
      }

      const publishResult =
        stagedArtifact.kind === 'directory'
          ? await mergeStagedDirectoryIntoRuntime({
              stagedPath: stagedArtifact.stagedPath,
              targetPath: stagedArtifact.targetPath,
              runtimeOwnership,
              createdTargets,
            })
          : await publishStagedArtifact({
              stagedPath: stagedArtifact.stagedPath,
              targetPath: stagedArtifact.targetPath,
              kind: stagedArtifact.kind,
            });
      if (publishResult === 'skipped_existing_runtime') {
        skippedArtifacts.push({
          artifact: stagedArtifact.artifact,
          action: 'skipped_existing_runtime',
          sourcePath: stagedArtifact.sourcePath,
          targetPath: stagedArtifact.targetPath,
        });
        continue;
      }
      if (stagedArtifact.kind === 'file') {
        createdTargets.push({
          targetPath: stagedArtifact.targetPath,
          stagedPath: stagedArtifact.stagedPath,
          kind: stagedArtifact.kind,
        });
        await normalizeArtifactAccess({
          targetPath: stagedArtifact.targetPath,
          kind: stagedArtifact.kind,
          runtimeOwnership,
        });
      }
      copiedArtifacts.push(stagedArtifact.artifact);
    }
  } catch (error) {
    await rollbackCreatedArtifacts(createdTargets);
    return {
      status: 'seed_copy_failed',
      runtimeHome,
      seedHome,
      copiedArtifacts,
      skippedArtifacts,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (stageRoot) {
      await cleanupPath(stageRoot).catch(() => {});
    }
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
