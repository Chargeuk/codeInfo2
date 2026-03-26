import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { afterEach, describe, test } from 'node:test';

import { append, query, resetStore } from '../../logStore.js';
import { createPlanScopeFixture } from '../support/planScopeFixture.js';

describe('planScopeFixture', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    resetStore();
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  test('creates working repository layouts and current-plan variants for later resolver tests', async () => {
    const happyPathFixture = await createPlanScopeFixture({
      additionalRepositories: [
        { name: 'repo-a' },
        { name: 'repo-b' },
        { name: 'missing-repo', create: false },
      ],
      planFile: {
        mode: 'valid',
        additionalRepositoryPaths: [],
        extraFields: {
          plan_path:
            'planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md',
          branched_from:
            'feature/0000052-users-can-reingest-the-working-repository-or-plan-scope',
          note: 'ignored-by-runtime',
        },
      },
    });
    cleanups.push(happyPathFixture.cleanup);

    const duplicatePath = happyPathFixture.additionalRepositoryPaths[0];
    const invalidPath = happyPathFixture.additionalRepositoryPaths[2];
    const planPayload = {
      plan_path:
        'planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md',
      branched_from:
        'feature/0000052-users-can-reingest-the-working-repository-or-plan-scope',
      additional_repositories: [
        { path: duplicatePath },
        { path: happyPathFixture.additionalRepositoryPaths[1] },
        { path: duplicatePath },
        { path: invalidPath },
      ],
      note: 'ignored-by-runtime',
    };
    await fs.writeFile(
      happyPathFixture.currentPlanPath,
      JSON.stringify(planPayload, null, 2),
    );

    const storedPlan = JSON.parse(
      await fs.readFile(happyPathFixture.currentPlanPath, 'utf-8'),
    ) as {
      additional_repositories: Array<{ path: string }>;
      note?: string;
    };
    assert.equal(
      storedPlan.additional_repositories[0]?.path,
      happyPathFixture.additionalRepositoryPaths[0],
    );
    assert.equal(
      storedPlan.additional_repositories[2]?.path,
      happyPathFixture.additionalRepositoryPaths[0],
    );
    assert.equal(
      storedPlan.additional_repositories[3]?.path,
      happyPathFixture.additionalRepositoryPaths[2],
    );
    assert.equal(storedPlan.note, 'ignored-by-runtime');

    const malformedFixture = await createPlanScopeFixture({
      planFile: {
        mode: 'malformed',
        rawText: '{"additional_repositories": [',
      },
    });
    cleanups.push(malformedFixture.cleanup);
    assert.match(
      await fs.readFile(malformedFixture.currentPlanPath, 'utf-8'),
      /additional_repositories/,
    );

    const invalidAdditionalRepositoriesFixture = await createPlanScopeFixture({
      planFile: {
        mode: 'invalid_additional_repositories',
        additionalRepositoriesValue: { path: 'not-an-array' },
      },
    });
    cleanups.push(invalidAdditionalRepositoriesFixture.cleanup);
    const invalidPayload = JSON.parse(
      await fs.readFile(
        invalidAdditionalRepositoriesFixture.currentPlanPath,
        'utf-8',
      ),
    ) as { additional_repositories: unknown };
    assert.deepEqual(invalidPayload.additional_repositories, {
      path: 'not-an-array',
    });

    const missingPlanFixture = await createPlanScopeFixture({
      planFile: { mode: 'missing' },
    });
    cleanups.push(missingPlanFixture.cleanup);
    await assert.rejects(
      fs.readFile(missingPlanFixture.currentPlanPath, 'utf-8'),
      (error) =>
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        (error as NodeJS.ErrnoException).path ===
          missingPlanFixture.currentPlanPath,
    );
  });

  test('supports a deterministic read-failure scenario and still cleans up', async () => {
    const unreadableFixture = await createPlanScopeFixture({
      additionalRepositories: [{ name: 'repo-a' }],
      planFile: { mode: 'unreadable' },
    });

    await assert.rejects(
      fs.readFile(unreadableFixture.currentPlanPath, 'utf-8'),
      (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        return code === 'EISDIR' || code === 'EPERM';
      },
    );

    append({
      level: 'info',
      message: 'DEV-0000052:T2:plan-scope-fixture-proof',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        outcome: 'fixture_backed_proof_passed',
        scenario: 'deterministic_read_failure',
      },
    });

    await unreadableFixture.cleanup();

    const logs = query({ text: 'DEV-0000052:T2:plan-scope-fixture-proof' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.context?.outcome, 'fixture_backed_proof_passed');

    await assert.rejects(
      fs.access(unreadableFixture.rootDir),
      (error) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    );
  });
});
