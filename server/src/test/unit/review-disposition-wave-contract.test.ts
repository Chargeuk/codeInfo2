import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(process.cwd(), '..');

type JsonObject = Record<string, unknown>;

const collectObjects = (value: unknown, result: JsonObject[] = []) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectObjects(entry, result));
  } else if (value && typeof value === 'object') {
    const object = value as JsonObject;
    result.push(object);
    Object.values(object).forEach((entry) => collectObjects(entry, result));
  }
  return result;
};

const productionFlows = [
  'task_and_implement_plan.json',
  'implement_next_plan.json',
  'improve_task_implement_plan.json',
];

const loadExpandedFlowObjects = async (
  flowName: string,
  ancestors: string[] = [],
): Promise<JsonObject[]> => {
  const relativeFlowName = flowName.endsWith('.json')
    ? flowName
    : `${flowName}.json`;
  assert.equal(
    ancestors.includes(relativeFlowName),
    false,
    `flow subflow cycle: ${[...ancestors, relativeFlowName].join(' -> ')}`,
  );
  const parsed = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'flows', relativeFlowName), 'utf8'),
  ) as { steps?: JsonObject[] };
  const expanded: JsonObject[] = [];
  const visit = async (steps: JsonObject[]) => {
    for (const step of steps) {
      expanded.push(step);
      if (Array.isArray(step.steps)) {
        await visit(step.steps as JsonObject[]);
      }
      if (step.type === 'subflow' && Array.isArray(step.flowNames)) {
        for (const childFlowName of step.flowNames) {
          assert.equal(typeof childFlowName, 'string');
          expanded.push(
            ...(await loadExpandedFlowObjects(childFlowName, [
              ...ancestors,
              relativeFlowName,
            ])),
          );
        }
      }
    }
  };
  await visit(parsed.steps ?? []);
  return expanded;
};

test('every production review loop produces the complete wave validation contract before consumers run', async () => {
  for (const flowName of productionFlows) {
    const objects = await loadExpandedFlowObjects(flowName);
    const validationPosition = objects.findIndex(
      (entry) =>
        entry.type === 'validateReviewWave' && entry.reviewPhase === 'fast',
    );
    assert.equal(
      validationPosition >= 0,
      true,
      `${flowName} must reach fast wave validation through its shared cycle`,
    );

    const downstreamPrompts = objects
      .slice(validationPosition + 1)
      .map((entry) => entry.markdownFile)
      .filter((entry): entry is string => typeof entry === 'string');
    for (const requiredConsumer of [
      'classify_review_disposition.md',
      'record_review_issue_decisions_in_plan.md',
      'verify_review_issue_decisions_recorded.md',
    ]) {
      assert.equal(
        downstreamPrompts.includes(requiredConsumer),
        true,
        `${flowName} must reach ${requiredConsumer} after validation`,
      );
    }
  }

  const cycle = JSON.parse(
    await fs.readFile(
      path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
      'utf8',
    ),
  ) as JsonObject;
  const cycleObjects = collectObjects(cycle);
  const fastSet = cycleObjects.find(
    (entry) =>
      entry.type === 'prepareReviewSet' && entry.reviewPhase === 'fast',
  );
  const slowSet = cycleObjects.find(
    (entry) =>
      entry.type === 'prepareReviewSet' && entry.reviewPhase === 'slow',
  );
  const fastWave = cycleObjects.find(
    (entry) =>
      entry.type === 'subflowWave' && entry.label === 'Run Fast Review Wave',
  );
  const slowWaves = cycleObjects.filter(
    (entry) =>
      entry.type === 'subflowWave' && entry.label === 'Run Slow Review Wave',
  );
  const fastGroups = fastWave?.groups as JsonObject[];
  const fastMatrix = fastGroups.find((group) => group.kind === 'matrix');
  const fastSingleton = fastGroups.find((group) => group.kind === 'singleton');
  const slowGroups = slowWaves[0]?.groups as JsonObject[];

  assert.deepEqual(fastSet?.reviewFlowNames, [
    'codex_review',
    'open_code_review',
  ]);
  assert.equal(fastSet?.crossRepositoryFlowName, 'cross_repository_review');
  assert.deepEqual(fastMatrix?.flowNames, ['codex_review', 'open_code_review']);
  assert.equal(fastSingleton?.flowName, 'cross_repository_review');
  assert.deepEqual(slowSet?.reviewFlowNames, ['review_artifacts_main']);
  assert.equal(slowSet?.crossRepositoryFlowName, undefined);
  assert.equal(slowWaves.length, 1);
  assert.deepEqual(slowGroups[0]?.flowNames, ['review_artifacts_main']);

  const producer = await fs.readFile(
    path.join(repoRoot, 'server/src/flows/reviewWaveValidation.ts'),
    'utf8',
  );
  for (const field of [
    'validation_file',
    'validation',
    'job_results',
    'aggregated_findings',
    'closeout_allowed',
    'review_cycle_id',
  ]) {
    assert.match(producer, new RegExp(`\\b${field}\\b`, 'u'));
  }
});

test('every reachable wave-mode prompt shares the authoritative consumer contract', async () => {
  for (const promptName of [
    'classify_review_disposition.md',
    'review_disposition.md',
    'write_review_no_findings_closeout.md',
    'filter_review_findings_to_story_scope.md',
    'promote_actionable_review_findings_to_minor_path.md',
    'record_review_issue_decisions_in_plan.md',
    'verify_review_issue_decisions_recorded.md',
    'ensure_review_findings_became_tasks.md',
    'load_coder_review_context.md',
    'load_lite_planner_review_context.md',
    'load_planner_review_context.md',
  ]) {
    const prompt = await fs.readFile(
      path.join(repoRoot, 'codeinfo_markdown', promptName),
      'utf8',
    );
    assert.match(
      prompt,
      /shared\/review-wave-consumer-contract\.md/u,
      `${promptName} must import the wave consumer contract`,
    );
  }

  const contract = await fs.readFile(
    path.join(
      repoRoot,
      'codeinfo_markdown/shared/review-wave-consumer-contract.md',
    ),
    'utf8',
  );
  for (const field of [
    'validation_file',
    'validation.usable',
    'validation.pointer_key',
    'validation.pointer_file',
    'target_id',
    'review_wave_id',
    'review_session_id',
    'review_pass_id',
    'review_cycle_id',
    'usable_bundle_ids',
  ]) {
    assert.match(contract, new RegExp(field.replace('.', '\\.'), 'u'));
  }
  assert.match(contract, /do not require or read the legacy plan-host/iu);
});

test('review disposition and classifier cannot claim a clean multi-target wave with unusable cross-repository coverage', async () => {
  for (const filename of [
    'review_disposition.md',
    'classify_review_disposition.md',
  ]) {
    const prompt = await fs.readFile(
      path.join(repoRoot, 'codeinfo_markdown', filename),
      'utf8',
    );
    assert.match(prompt, /current-review-set\.json/u);
    assert.match(prompt, /current-review-wave-validation\.json/u);
    assert.match(prompt, /closeout_allowed: false/u);
    assert.match(prompt, /cross-repository coverage/iu);
  }
});
