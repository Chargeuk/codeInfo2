import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type PlanScopeFixtureRepoDefinition = {
  name: string;
  create?: boolean;
};

export type PlanScopeFixturePlanFileOptions =
  | {
      mode: 'missing';
    }
  | {
      mode: 'valid';
      additionalRepositoryPaths?: string[];
      extraFields?: Record<string, unknown>;
    }
  | {
      mode: 'malformed';
      rawText?: string;
    }
  | {
      mode: 'invalid_additional_repositories';
      additionalRepositoriesValue: unknown;
      extraFields?: Record<string, unknown>;
    }
  | {
      mode: 'unreadable';
      additionalRepositoryPaths?: string[];
      extraFields?: Record<string, unknown>;
    };

export type PlanScopeFixtureOptions = {
  tempPrefix?: string;
  workingRepositoryName?: string;
  additionalRepositories?: PlanScopeFixtureRepoDefinition[];
  planFile?: PlanScopeFixturePlanFileOptions;
};

export type PlanScopeFixture = {
  rootDir: string;
  workingRepositoryPath: string;
  flowStateDir: string;
  currentPlanPath: string;
  additionalRepositoryPaths: string[];
  cleanup: () => Promise<void>;
};

function buildPlanPayload(params: {
  additionalRepositoryPaths: string[];
  extraFields?: Record<string, unknown>;
}) {
  return {
    plan_path:
      'planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md',
    branched_from: 'main',
    additional_repositories: params.additionalRepositoryPaths.map(
      (repoPath) => ({
        path: repoPath,
      }),
    ),
    ...params.extraFields,
  };
}

export async function createPlanScopeFixture(
  options: PlanScopeFixtureOptions = {},
): Promise<PlanScopeFixture> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), options.tempPrefix ?? 'plan-scope-fixture-'),
  );
  const workingRepositoryPath = path.join(
    rootDir,
    options.workingRepositoryName ?? 'working-repo',
  );
  const flowStateDir = path.join(
    workingRepositoryPath,
    'codeInfoStatus',
    'flow-state',
  );
  const currentPlanPath = path.join(flowStateDir, 'current-plan.json');

  await fs.mkdir(workingRepositoryPath, { recursive: true });

  const additionalRepositories = options.additionalRepositories ?? [];
  const additionalRepositoryPaths: string[] = [];

  for (const repository of additionalRepositories) {
    const repositoryPath = path.join(rootDir, repository.name);
    additionalRepositoryPaths.push(repositoryPath);
    if (repository.create !== false) {
      await fs.mkdir(repositoryPath, { recursive: true });
    }
  }

  const planFile = options.planFile ?? { mode: 'valid' as const };
  const defaultAdditionalRepositoryPaths = additionalRepositoryPaths;

  if (planFile.mode !== 'missing') {
    await fs.mkdir(flowStateDir, { recursive: true });
  }

  if (planFile.mode === 'valid') {
    const payload = buildPlanPayload({
      additionalRepositoryPaths:
        planFile.additionalRepositoryPaths ?? defaultAdditionalRepositoryPaths,
      extraFields: planFile.extraFields,
    });
    await fs.writeFile(currentPlanPath, JSON.stringify(payload, null, 2));
  } else if (planFile.mode === 'malformed') {
    await fs.writeFile(
      currentPlanPath,
      planFile.rawText ?? '{"additional_repositories": [',
    );
  } else if (planFile.mode === 'invalid_additional_repositories') {
    const payload = {
      plan_path:
        'planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md',
      branched_from: 'main',
      additional_repositories: planFile.additionalRepositoriesValue,
      ...planFile.extraFields,
    };
    await fs.writeFile(currentPlanPath, JSON.stringify(payload, null, 2));
  } else if (planFile.mode === 'unreadable') {
    // A directory at the file path gives later tests a deterministic read failure.
    await fs.mkdir(currentPlanPath, { recursive: true });
  }

  return {
    rootDir,
    workingRepositoryPath,
    flowStateDir,
    currentPlanPath,
    additionalRepositoryPaths,
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}
