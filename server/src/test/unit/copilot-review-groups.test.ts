import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prepareCopilotReviewGroups } from '../../flows/copilotReviewGroups.js';
import { expandSubflowWaveJobs } from '../../flows/subflowWave.js';
import { waitForCondition } from '../support/waitForCondition.js';

const existingGroups = [
  {
    kind: 'matrix' as const,
    id: 'existing',
    itemsFrom: 'review_batch_targets.targets',
    itemName: 'target',
    flowNames: ['codex_review'],
    bindings: {
      workingFolderFrom: 'target.repo_root',
      input: { target: 'target' },
    },
  },
];

const targets = [
  { target_id: 'repo-a', repo_root: '/repos/a' },
  { target_id: 'repo-b', repo_root: '/repos/b' },
];

test('two repositories and three Copilot models produce exactly six isolated same-wave jobs', async () => {
  const prepared = await prepareCopilotReviewGroups(
    {
      reviewGroups: existingGroups,
      repositoryTargets: targets,
      targetItemsFrom: 'review_batch_targets.targets',
      reviewWaveFrom: 'review_batch_targets',
      env: {
        CODEINFO_COPILOT_REVIEW_MODELS:
          'gpt-5.4|low,unsloth::gemini|minimal,other::flash|high',
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'Unsloth,https://unsloth.test/v1|completions;Other,https://other.test/v1|completions',
      },
    },
    {
      checkCli: async () => true,
      discoverNative: async () => ({
        status: 'available',
        models: ['gpt-5.4'],
      }),
      discoverExternal: async (endpoint) => ({
        available: true,
        models: endpoint.authLookupKey === 'unsloth' ? ['gemini'] : ['flash'],
      }),
    },
  );
  assert.equal(prepared.repositoryCount, 2);
  assert.equal(prepared.modelCount, 3);
  assert.equal(prepared.copilotJobCount, 6);
  assert.deepEqual(prepared.effectiveReviewGroups[0], existingGroups[0]);

  const jobs = expandSubflowWaveJobs({
    step: {
      type: 'subflowWave',
      groupsFrom: 'effective_review_groups',
    },
    input: {
      review_batch_targets: { targets },
      effective_review_groups: prepared.effectiveReviewGroups,
    },
  });
  const copilotJobs = jobs.filter((job) => job.flowName === 'copilot_review');
  assert.equal(copilotJobs.length, 6);
  assert.equal(new Set(copilotJobs.map((job) => job.instanceId)).size, 6);
  assert.equal(
    new Set(copilotJobs.map((job) => job.instanceId.split(':')[0])).size,
    3,
  );
  assert.deepEqual(
    new Set(copilotJobs.map((job) => job.targetId)),
    new Set(['repo-a', 'repo-b']),
  );
  for (const job of copilotJobs) {
    assert.match(
      job.instanceId,
      /^copilot-[A-Za-z0-9._-]+:repo-[ab]:copilot_review$/u,
    );
    assert.match(job.displayName, /^Copilot: .+ \(.+\) \[repo-[ab]\]$/u);
    assert.equal(
      (job.input?.copilot_review_spec as { modelId?: string })?.modelId !==
        undefined,
      true,
    );
    assert.equal(
      (job.input?.target as { target_id?: string })?.target_id,
      job.targetId,
    );
    assert.equal(job.workingFolder, `/repos/${job.targetId?.slice(-1)}`);
  }
});

test('unavailable models remain one terminal coverage job per repository', async () => {
  const prepared = await prepareCopilotReviewGroups(
    {
      reviewGroups: existingGroups,
      repositoryTargets: targets,
      targetItemsFrom: 'review_batch_targets.targets',
      reviewWaveFrom: 'review_batch_targets',
      env: { CODEINFO_COPILOT_REVIEW_MODELS: 'missing|low' },
    },
    {
      checkCli: async () => true,
      discoverNative: async () => ({
        status: 'available',
        models: ['other'],
      }),
    },
  );
  const jobs = expandSubflowWaveJobs({
    step: { type: 'subflowWave', groupsFrom: 'effective_review_groups' },
    input: {
      review_batch_targets: { targets },
      effective_review_groups: prepared.effectiveReviewGroups,
    },
  }).filter((job) => job.flowName === 'copilot_review');
  assert.equal(jobs.length, 2);
  assert.equal(
    jobs.every(
      (job) =>
        (job.input?.copilot_review_spec as { available?: boolean })
          ?.available === false,
    ),
    true,
  );
});

test('blank configuration preserves the pre-change review group structure exactly', async () => {
  const prepared = await prepareCopilotReviewGroups({
    reviewGroups: existingGroups,
    repositoryTargets: targets,
    targetItemsFrom: 'review_batch_targets.targets',
    reviewWaveFrom: 'review_batch_targets',
    env: { CODEINFO_COPILOT_REVIEW_MODELS: ' ' },
  });
  assert.deepEqual(prepared.effectiveReviewGroups, existingGroups);
  assert.equal(prepared.copilotJobCount, 0);
});

test('malformed and duplicate entries warn while every valid unique model is scheduled', async () => {
  const prepared = await prepareCopilotReviewGroups(
    {
      reviewGroups: existingGroups,
      repositoryTargets: targets,
      targetItemsFrom: 'prepared.repositories',
      reviewWaveFrom: 'prepared',
      env: {
        CODEINFO_COPILOT_REVIEW_MODELS:
          'gpt-5.4|low,bad,gpt-5.4|high,external::flash|minimal',
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'External,https://external.test/v1|completions',
      },
    },
    {
      checkCli: async () => true,
      discoverNative: async () => ({
        status: 'available',
        models: ['gpt-5.4'],
      }),
      discoverExternal: async () => ({
        available: true,
        models: ['flash'],
      }),
    },
  );
  assert.equal(prepared.modelCount, 2);
  assert.equal(prepared.copilotJobCount, 4);
  assert.deepEqual(
    prepared.configurationWarnings.map((warning) => warning.code),
    ['invalid_delimiters', 'duplicate_selector'],
  );
  const copilotGroups = prepared.effectiveReviewGroups.slice(1);
  assert.equal(
    copilotGroups.every(
      (group) =>
        group.kind === 'matrix' &&
        group.itemsFrom === 'prepared.repositories' &&
        group.bindings?.input?.review_wave === 'prepared',
    ),
    true,
  );
  const jobs = expandSubflowWaveJobs({
    step: { type: 'subflowWave', groupsFrom: 'effective_review_groups' },
    input: {
      prepared: { repositories: targets },
      review_batch_targets: { targets },
      effective_review_groups: prepared.effectiveReviewGroups,
    },
  }).filter((job) => job.flowName === 'copilot_review');
  assert.equal(jobs.length, 4);
  assert.equal(new Set(jobs.map((job) => job.instanceId)).size, 4);
});

test('endpoint parser warnings join the visible secret-free configuration warning result', async () => {
  const prepared = await prepareCopilotReviewGroups(
    {
      reviewGroups: existingGroups,
      repositoryTargets: targets,
      targetItemsFrom: 'review_batch_targets.targets',
      reviewWaveFrom: 'review_batch_targets',
      env: {
        CODEINFO_COPILOT_REVIEW_MODELS: 'openrouter::flash|minimal',
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'OpenRouter,https://openrouter.test/v1|completions;Duplicate,https://openrouter.test/v1|completions',
      },
    },
    {
      checkCli: async () => true,
      discoverExternal: async () => ({
        available: true,
        models: ['flash'],
      }),
    },
  );

  assert.deepEqual(
    prepared.configurationWarnings.map((warning) => warning.code),
    ['external_endpoint_configuration'],
  );
  assert.match(
    prepared.configurationWarnings[0]?.message ?? '',
    /keeping first entry/u,
  );
  assert.doesNotMatch(
    JSON.stringify(prepared.configurationWarnings),
    /api[_-]?key|secret/iu,
  );
});

test('group preparation forwards cancellation to model discovery', async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const preparation = prepareCopilotReviewGroups(
    {
      reviewGroups: existingGroups,
      repositoryTargets: targets,
      targetItemsFrom: 'review_batch_targets.targets',
      reviewWaveFrom: 'review_batch_targets',
      env: { CODEINFO_COPILOT_REVIEW_MODELS: 'gpt-5.4|low' },
      signal: controller.signal,
    },
    {
      checkCli: async (_env, signal) => {
        receivedSignal = signal;
        return new Promise<boolean>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('cancelled');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
      },
    },
  );

  await waitForCondition(
    () => receivedSignal !== undefined,
    'Copilot group preparation did not receive its cancellation signal.',
  );
  controller.abort();
  await assert.rejects(preparation, { name: 'AbortError' });
  assert.equal(receivedSignal, controller.signal);
});
