import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { prepareReviewTargets } from '../../flows/reviewTargets.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';

const execFile = promisify(execFileCb);

const repoEntry = (id: string, root: string): RepoEntry => ({
  id,
  description: null,
  containerPath: root,
  hostPath: root,
  lastIngestAt: '2026-07-14T00:00:00.000Z',
  embeddingProvider: 'lmstudio',
  embeddingModel: 'test-model',
  embeddingDimensions: 3,
  modelId: 'test-model',
  counts: { files: 1, chunks: 1, embedded: 1 },
  lastError: null,
});

const createRepository = async (
  parent: string,
  name: string,
  branch = 'feature/0000064-parallel-review',
) => {
  const root = path.join(parent, name);
  await fs.mkdir(root, { recursive: true });
  await execFile('git', ['init', '-b', branch], { cwd: root });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], {
    cwd: root,
  });
  await execFile('git', ['config', 'user.name', 'Tests'], { cwd: root });
  await fs.writeFile(path.join(root, 'README.md'), `${name}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: root });
  await execFile('git', ['commit', '-m', 'initial'], { cwd: root });
  await execFile('git', ['branch', 'main'], { cwd: root });
  return root;
};

const prepareFixture = async (additionalCount: number) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-targets-'));
  const primary = await createRepository(tempRoot, 'primary');
  const additional = await Promise.all(
    Array.from({ length: additionalCount }, (_, index) =>
      createRepository(tempRoot, `additional-${index + 1}`),
    ),
  );
  await fs.mkdir(path.join(primary, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(primary, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({
      plan_path: 'planning/0000064-parallel-review.md',
      additional_repositories: additional.map((repoRoot) => ({
        path: repoRoot,
      })),
    }),
  );
  const repositories = [
    repoEntry('primary', primary),
    ...additional.map((root, index) =>
      repoEntry(`additional-${index + 1}`, root),
    ),
  ];
  return { tempRoot, primary, additional, repositories };
};

test('prepareReviewTargets snapshots one and three canonical repository targets', async (t) => {
  for (const additionalCount of [0, 2]) {
    await t.test(`${additionalCount + 1} target(s)`, async () => {
      const fixture = await prepareFixture(additionalCount);
      try {
        const result = await prepareReviewTargets(
          {
            workingRepositoryPath: fixture.primary,
          },
          {
            listIngestedRepositories: async () => ({
              repos: fixture.repositories,
              lockedModelId: null,
            }),
            resolveWorkingDirectory: async (workingFolder) => workingFolder,
            now: () => new Date('2026-07-14T12:00:00.000Z'),
            randomHex: () => 'a1b2c3d4',
          },
        );

        assert.equal(result.snapshot.targets.length, additionalCount + 1);
        assert.equal(
          result.snapshot.targets[0]?.repo_alias,
          'current_repository',
        );
        assert.equal(result.snapshot.story_id, '0000064');
        assert.match(result.snapshot.targets_sha256, /^[a-f0-9]{64}$/u);
        assert.equal(
          result.snapshot.targets.every(
            (target) =>
              target.branch === 'feature/0000064-parallel-review' &&
              target.head_commit.length === 40 &&
              target.comparison_base_commit?.length === 40,
          ),
          true,
        );
        assert.deepEqual(
          JSON.parse(await fs.readFile(result.versionedPath, 'utf8')),
          result.snapshot,
        );
        await assert.rejects(
          fs.access(
            path.join(
              fixture.primary,
              'codeInfoTmp',
              'reviews',
              '0000064-current-review-targets.json',
            ),
          ),
          { code: 'ENOENT' },
        );
      } finally {
        await fs.rm(fixture.tempRoot, { recursive: true, force: true });
      }
    });
  }
});

test('prepareReviewTargets resolves relative additional repositories from the plan host', async () => {
  const fixture = await prepareFixture(1);
  try {
    await fs.writeFile(
      path.join(
        fixture.primary,
        'codeInfoStatus',
        'flow-state',
        'current-plan.json',
      ),
      JSON.stringify({
        plan_path: 'planning/0000064-parallel-review.md',
        additional_repositories: [
          { path: path.relative(fixture.primary, fixture.additional[0]!) },
        ],
      }),
    );

    const result = await prepareReviewTargets(
      { workingRepositoryPath: fixture.primary },
      {
        listIngestedRepositories: async () => ({
          repos: fixture.repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) =>
          path.isAbsolute(workingFolder) ? workingFolder : undefined,
      },
    );

    assert.equal(result.snapshot.targets[1]?.repo_root, fixture.additional[0]);
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('prepareReviewTargets ignores a redundant primary root but rejects duplicate additional roots and story-mismatched branches', async () => {
  const fixture = await prepareFixture(1);
  try {
    const currentPlanPath = path.join(
      fixture.primary,
      'codeInfoStatus',
      'flow-state',
      'current-plan.json',
    );
    await fs.writeFile(
      currentPlanPath,
      JSON.stringify({
        plan_path: 'planning/0000064-parallel-review.md',
        additional_repositories: [{ path: fixture.primary }],
      }),
    );
    const dependencies = {
      listIngestedRepositories: async () => ({
        repos: fixture.repositories,
        lockedModelId: null,
      }),
      resolveWorkingDirectory: async (workingFolder: string) => workingFolder,
    };
    const redundantPrimary = await prepareReviewTargets(
      {
        workingRepositoryPath: fixture.primary,
      },
      dependencies,
    );
    assert.equal(redundantPrimary.snapshot.targets.length, 1);

    await fs.writeFile(
      currentPlanPath,
      JSON.stringify({
        plan_path: 'planning/0000064-parallel-review.md',
        additional_repositories: [
          { path: fixture.additional[0] },
          { path: fixture.additional[0] },
        ],
      }),
    );
    await assert.rejects(
      prepareReviewTargets(
        {
          workingRepositoryPath: fixture.primary,
        },
        dependencies,
      ),
      /duplicates/u,
    );

    await fs.writeFile(
      currentPlanPath,
      JSON.stringify({
        plan_path: 'planning/0000065-parallel-review.md',
        additional_repositories: [],
      }),
    );
    await assert.rejects(
      prepareReviewTargets(
        {
          workingRepositoryPath: fixture.primary,
        },
        dependencies,
      ),
      /does not match plan story 0000065/u,
    );
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('prepareReviewTargets requires canonical seven-digit story branches', async () => {
  const fixture = await prepareFixture(0);
  try {
    await execFile('git', ['branch', '-m', 'feature/64-other-story'], {
      cwd: fixture.primary,
    });
    await assert.rejects(
      prepareReviewTargets(
        { workingRepositoryPath: fixture.primary },
        {
          listIngestedRepositories: async () => ({
            repos: fixture.repositories,
            lockedModelId: null,
          }),
          resolveWorkingDirectory: async (workingFolder) => workingFolder,
        },
      ),
      /does not match plan story 0000064/u,
    );

    await execFile('git', ['branch', '-m', 'feature/00000640-other-story'], {
      cwd: fixture.primary,
    });

    await assert.rejects(
      prepareReviewTargets(
        { workingRepositoryPath: fixture.primary },
        {
          listIngestedRepositories: async () => ({
            repos: fixture.repositories,
            lockedModelId: null,
          }),
          resolveWorkingDirectory: async (workingFolder) => workingFolder,
        },
      ),
      /does not match plan story 0000064/u,
    );
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('prepareReviewTargets disambiguates colliding normalized additional aliases', async () => {
  const fixture = await prepareFixture(2);
  try {
    const repositories = fixture.repositories.map((repository, index) =>
      index === 1
        ? { ...repository, id: 'shared/repository' }
        : index === 2
          ? { ...repository, id: 'shared?repository' }
          : repository,
    );
    const result = await prepareReviewTargets(
      { workingRepositoryPath: fixture.primary },
      {
        listIngestedRepositories: async () => ({
          repos: repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) => workingFolder,
      },
    );

    const aliases = result.snapshot.targets.map((target) => target.repo_alias);
    assert.equal(new Set(aliases).size, aliases.length);
    assert.equal(aliases[1], 'shared-repository');
    assert.match(aliases[2] ?? '', /^shared-repository-[a-f0-9]{12}$/u);
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('a saved target snapshot remains pinned when a repository HEAD later moves', async () => {
  const fixture = await prepareFixture(1);
  try {
    const result = await prepareReviewTargets(
      {
        workingRepositoryPath: fixture.primary,
      },
      {
        listIngestedRepositories: async () => ({
          repos: fixture.repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) => workingFolder,
      },
    );
    const pinnedHead = result.snapshot.targets[1]?.head_commit;
    const additionalRoot = fixture.additional[0] as string;
    await fs.writeFile(path.join(additionalRoot, 'next.txt'), 'next\n');
    await execFile('git', ['add', 'next.txt'], { cwd: additionalRoot });
    await execFile('git', ['commit', '-m', 'next'], { cwd: additionalRoot });
    const movedHead = (
      await execFile('git', ['rev-parse', 'HEAD'], { cwd: additionalRoot })
    ).stdout.trim();
    const persisted = JSON.parse(
      await fs.readFile(result.versionedPath, 'utf8'),
    ) as typeof result.snapshot;

    assert.notEqual(movedHead, pinnedHead);
    assert.equal(persisted.targets[1]?.head_commit, pinnedHead);
    assert.equal(persisted.targets_sha256, result.snapshot.targets_sha256);
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('additional targets use only their repository-local comparison-base hints', async () => {
  const fixture = await prepareFixture(1);
  try {
    const additionalRoot = fixture.additional[0] as string;
    await fs.writeFile(path.join(additionalRoot, 'next.txt'), 'next\n');
    await execFile('git', ['add', 'next.txt'], { cwd: additionalRoot });
    await execFile('git', ['commit', '-m', 'next'], { cwd: additionalRoot });
    await execFile('git', ['branch', 'host-only'], { cwd: additionalRoot });
    await fs.writeFile(
      path.join(
        fixture.primary,
        'codeInfoStatus',
        'flow-state',
        'current-plan.json',
      ),
      JSON.stringify({
        plan_path: 'planning/0000064-parallel-review.md',
        branched_from: 'host-only',
        additional_repositories: [{ path: additionalRoot }],
      }),
    );

    const result = await prepareReviewTargets(
      { workingRepositoryPath: fixture.primary },
      {
        listIngestedRepositories: async () => ({
          repos: fixture.repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) => workingFolder,
      },
    );
    const additionalBase = (
      await execFile('git', ['rev-parse', 'main'], { cwd: additionalRoot })
    ).stdout.trim();

    assert.equal(
      result.snapshot.targets[1]?.comparison_base_commit,
      additionalBase,
    );
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('diagnostic target preparation does not adopt an active final review cycle', async () => {
  const fixture = await prepareFixture(0);
  try {
    await fs.writeFile(
      path.join(
        fixture.primary,
        'codeInfoStatus',
        'flow-state',
        'active-review-cycle.json',
      ),
      JSON.stringify({
        review_cycle_id: '0000064-rc-final',
        review_mode: 'final',
        story_id: '0000064',
        plan_path: 'planning/0000064-parallel-review.md',
        status: 'in_progress',
      }),
    );
    const result = await prepareReviewTargets(
      { workingRepositoryPath: fixture.primary, reviewMode: 'diagnostic' },
      {
        listIngestedRepositories: async () => ({
          repos: fixture.repositories,
          lockedModelId: null,
        }),
        resolveWorkingDirectory: async (workingFolder) => workingFolder,
      },
    );

    assert.equal(result.snapshot.review_cycle_id, undefined);
    assert.equal(result.snapshot.review_mode, undefined);
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('PR preparation pins its explicit local base and keeps unavailable siblings without fetching on later batches', async () => {
  const fixture = await prepareFixture(1);
  try {
    const root = await fs.realpath(fixture.primary);
    const sibling = await fs.realpath(fixture.additional[0]!);
    const branch = 'feature/0000064-parallel-review';
    const original = (
      await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim();
    await fs.writeFile(path.join(root, 'target.txt'), 'PR base\n');
    await execFile('git', ['add', 'target.txt'], { cwd: root });
    await execFile('git', ['commit', '-m', 'target base'], { cwd: root });
    const prBase = (
      await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim();
    assert.notEqual(prBase, original);
    const statePath = path.join(
      root,
      'codeInfoStatus',
      'flow-state',
      'active-review-cycle.json',
    );
    const cycle = {
      schema_version: 'codeinfo-active-review-cycle/v2',
      review_cycle_id: '0000064-rc-test',
      review_mode: 'final',
      story_id: '0000064',
      plan_path: 'planning/0000064-parallel-review.md',
      status: 'in_progress',
      pr_preparation: {
        review_cycle_id: '0000064-rc-test',
        plan_path: 'planning/0000064-parallel-review.md',
        targets: [
          {
            repo_root: root,
            branch,
            status: 'ready',
            base_branch: 'release',
            base_commit: prBase,
            base_source: 'pr',
            integration: 'behind',
            evidence: ['attempt task 42'],
          },
          {
            repo_root: sibling,
            branch,
            status: 'unavailable',
            reason: 'PR lookup failed',
            evidence: ['attempt task 43'],
          },
        ],
      },
    };
    await fs.writeFile(statePath, JSON.stringify(cycle));
    const commands: string[][] = [];
    let injectedFailure: Error | null = null;
    const dependencies = {
      listIngestedRepositories: async () => ({
        repos: fixture.repositories,
        lockedModelId: null,
      }),
      resolveWorkingDirectory: async (workingFolder: string) => workingFolder,
      execFile: (async (...args: Parameters<typeof execFile>) => {
        const commandArgs = args[1] ?? [];
        commands.push([...commandArgs]);
        if (
          commandArgs[0] === 'rev-parse' &&
          commandArgs[1] === '--verify' &&
          injectedFailure
        )
          throw injectedFailure;
        return execFile(...args);
      }) as typeof execFile,
    };
    for (const integration of ['behind', 'up_to_date'] as const) {
      cycle.pr_preparation.targets[0]!.integration = integration;
      await fs.writeFile(statePath, JSON.stringify(cycle));
      const { snapshot } = await prepareReviewTargets(
        { workingRepositoryPath: root },
        dependencies,
      );
      assert.equal(snapshot.targets[0]?.comparison_base_commit, prBase);
      assert.equal(snapshot.targets[0]?.pr_preparation?.base_branch, 'release');
      assert.equal(
        snapshot.targets[0]?.pr_preparation?.integration,
        integration,
      );
      assert.equal(snapshot.targets[1]?.comparison_base_commit, undefined);
      assert.equal(
        snapshot.targets[1]?.pr_preparation?.reason,
        'PR lookup failed',
      );
    }
    assert.equal(
      commands.some((args) => args[0] === 'fetch'),
      false,
    );

    injectedFailure = Object.assign(new Error('token=secret'), {
      code: 'EACCES',
      stderr: 'token=secret',
    });
    const failed = await prepareReviewTargets(
      { workingRepositoryPath: root, requirePrPreparation: true },
      dependencies,
    );
    assert.match(
      failed.snapshot.targets[0]?.pr_preparation?.reason ?? '',
      /rev-parse --verify failed \(EACCES\)/u,
    );
    assert.doesNotMatch(
      failed.snapshot.targets[0]?.pr_preparation?.reason ?? '',
      /secret/u,
    );
    injectedFailure = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    await assert.rejects(
      prepareReviewTargets(
        { workingRepositoryPath: root, requirePrPreparation: true },
        dependencies,
      ),
      { name: 'AbortError' },
    );
    injectedFailure = null;

    cycle.pr_preparation.review_cycle_id = '0000064-rc-stale';
    await fs.writeFile(statePath, JSON.stringify(cycle));
    const stale = await prepareReviewTargets(
      { workingRepositoryPath: root },
      dependencies,
    );
    assert.equal(
      stale.snapshot.targets.every(
        (target) =>
          !target.comparison_base_commit &&
          target.pr_preparation?.status === 'unavailable',
      ),
      true,
    );
    assert.equal(
      commands.some((args) => args[0] === 'fetch'),
      false,
    );
    assert.equal(
      commands.some((args) => args[0] === 'remote'),
      false,
    );

    cycle.pr_preparation.review_cycle_id = cycle.review_cycle_id;
    cycle.pr_preparation.targets[0]!.branch = 'feature/0000064-other';
    await fs.writeFile(statePath, JSON.stringify(cycle));
    const wrongBranch = await prepareReviewTargets(
      { workingRepositoryPath: root },
      dependencies,
    );
    assert.equal(
      wrongBranch.snapshot.targets[0]?.pr_preparation?.status,
      'unavailable',
    );
    assert.equal(
      wrongBranch.snapshot.targets[0]?.comparison_base_commit,
      undefined,
    );
    cycle.pr_preparation.targets[0]!.branch = branch;
    cycle.pr_preparation.targets[0]!.base_commit = 'f'.repeat(40);
    await fs.writeFile(statePath, JSON.stringify(cycle));
    const missingCommit = await prepareReviewTargets(
      { workingRepositoryPath: root },
      dependencies,
    );
    assert.equal(
      missingCommit.snapshot.targets[0]?.pr_preparation?.status,
      'unavailable',
    );
    assert.equal(
      missingCommit.snapshot.targets[0]?.comparison_base_commit,
      undefined,
    );
    assert.match(
      missingCommit.snapshot.targets[0]?.pr_preparation?.reason ?? '',
      /Local git rev-parse --verify failed \(exit \d+\)/u,
    );

    const siblingBase = (
      await execFile('git', ['rev-parse', 'HEAD'], { cwd: sibling })
    ).stdout.trim();
    const siblingReady = {
      repo_root: sibling,
      branch,
      status: 'ready',
      base_branch: 'target',
      base_commit: siblingBase,
      base_source: 'pr',
      integration: 'up_to_date',
      evidence: ['sibling attempt'],
    };
    const { pr_preparation: _preparation, ...cycleWithoutPreparation } = cycle;
    const requiredCases = [
      cycleWithoutPreparation,
      { ...cycleWithoutPreparation, pr_preparation: null },
      {
        ...cycleWithoutPreparation,
        pr_preparation: {
          ...cycle.pr_preparation,
          targets: [null, siblingReady],
        },
      },
      {
        ...cycleWithoutPreparation,
        pr_preparation: {
          ...cycle.pr_preparation,
          targets: [
            { ...siblingReady, repo_root: '/different/canonical/root' },
            siblingReady,
          ],
        },
      },
    ];
    for (const [index, active] of requiredCases.entries()) {
      await fs.writeFile(statePath, JSON.stringify(active));
      const required = await prepareReviewTargets(
        { workingRepositoryPath: root, requirePrPreparation: true },
        dependencies,
      );
      assert.equal(
        required.snapshot.targets[0]?.pr_preparation?.status,
        'unavailable',
      );
      assert.equal(
        required.snapshot.targets[0]?.comparison_base_commit,
        undefined,
      );
      assert.equal(
        required.snapshot.targets[1]?.pr_preparation?.status,
        index < 2 ? 'unavailable' : 'ready',
      );
      assert.equal(
        required.snapshot.targets[1]?.comparison_base_commit,
        index < 2 ? undefined : siblingBase,
      );
    }
    await fs.unlink(statePath);
    const noCycle = await prepareReviewTargets(
      { workingRepositoryPath: root, requirePrPreparation: true },
      dependencies,
    );
    assert.equal(
      noCycle.snapshot.targets.every(
        (target) => target.pr_preparation?.status === 'unavailable',
      ),
      true,
    );
    assert.equal(
      commands.some((args) => args[0] === 'remote' || args[0] === 'fetch'),
      false,
    );
  } finally {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
