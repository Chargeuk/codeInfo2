import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseFlowFile } from '../../flows/flowSchema.js';
import { query, resetStore } from '../../logStore.js';

describe('flow schema (v1)', () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );

  type FlowStep = {
    type: string;
    label?: string;
    agentType?: string;
    identifier?: string;
    continueOnFailure?: boolean;
    continueOn?: string;
    steps?: FlowStep[];
    commandName?: string;
    markdownFile?: string;
    flowNames?: string[];
    reviewFlowNames?: string[];
    pointerKeys?: string[];
    ensureCanonicalFallback?: boolean;
    reviewPhase?: string;
    crossRepositoryFlowName?: string;
    groups?: Array<{
      kind?: string;
      flowNames?: string[];
      flowName?: string;
    }>;
  };

  const flattenSteps = (steps: FlowStep[]): FlowStep[] => {
    const flattened: FlowStep[] = [];
    for (const step of steps) {
      flattened.push(step);
      if (Array.isArray(step.steps)) {
        flattened.push(...flattenSteps(step.steps));
      }
    }
    return flattened;
  };

  const loadExpandedFlowSteps = async (
    relativePath: string,
    ancestors: string[] = [],
  ): Promise<FlowStep[]> => {
    assert.equal(
      ancestors.includes(relativePath),
      false,
      `flow subflow cycle: ${[...ancestors, relativePath].join(' -> ')}`,
    );
    const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    assert.ok(
      Array.isArray(parsed.steps),
      `${relativePath} should define steps`,
    );

    const expandSteps = async (steps: FlowStep[]): Promise<FlowStep[]> => {
      const expanded: FlowStep[] = [];
      for (const step of steps) {
        expanded.push(step);
        if (Array.isArray(step.steps)) {
          expanded.push(...(await expandSteps(step.steps)));
        }
        for (const flowName of step.flowNames ?? []) {
          expanded.push(
            ...(await loadExpandedFlowSteps(`flows/${flowName}.json`, [
              ...ancestors,
              relativePath,
            ])),
          );
        }
      }
      return expanded;
    };

    return expandSteps(parsed.steps ?? []);
  };

  const assertOrdered = (
    labels: Array<string | undefined>,
    before: string,
    after: string,
  ) => {
    const beforeIndex = labels.indexOf(before);
    const afterIndex = labels.indexOf(after);
    assert.notEqual(beforeIndex, -1, `missing flow step: ${before}`);
    assert.notEqual(afterIndex, -1, `missing flow step: ${after}`);
    assert.ok(beforeIndex < afterIndex, `${before} should precede ${after}`);
  };

  test('does not emit Story 45 parse logs unless explicitly requested', () => {
    resetStore();
    const json = JSON.stringify({
      steps: [{ type: 'reingest', sourceId: '/tmp/repo' }],
    });

    const parsed = parseFlowFile(json, { flowName: 'sample' });
    assert.equal(parsed.ok, true);
    assert.equal(
      query({ text: 'DEV-0000045:T2:flow_schema_step_parsed' }).length,
      0,
    );
  });

  test('emits Story 45 parse logs with 1-based step indexes when requested', () => {
    resetStore();
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          messages: [{ role: 'user', content: ['Hello'] }],
        },
        { type: 'reingest', sourceId: '/tmp/repo' },
      ],
    });

    const parsed = parseFlowFile(json, {
      flowName: 'sample',
      emitSchemaParseLogs: true,
    });
    assert.equal(parsed.ok, true);

    const logs = query({ text: 'DEV-0000045:T2:flow_schema_step_parsed' });
    assert.equal(logs.length, 2);
    assert.equal(logs[0]?.context?.stepIndex, 1);
    assert.equal(logs[1]?.context?.stepIndex, 2);
  });

  test('valid flow JSON parses as ok: true', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          messages: [{ role: 'user', content: ['Hello'] }],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
  });

  test('valid subflow step parses as ok: true', () => {
    const json = JSON.stringify({
      description: 'Subflow parent',
      steps: [
        {
          type: 'subflow',
          label: 'Run child',
          flowNames: ['child-flow'],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
  });

  test('valid mixed subflow wave parses as ok: true', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'subflowWave',
            label: 'Run review wave',
            failureMode: 'best_effort',
            groups: [
              {
                kind: 'matrix',
                id: 'target_reviews',
                itemsFrom: 'review_targets',
                itemName: 'target',
                flowNames: ['main_review', 'codex_review'],
                bindings: {
                  workingFolderFrom: 'target.repo_root',
                  input: { review_target: 'target' },
                },
              },
              {
                kind: 'singleton',
                id: 'cross_repository',
                flowName: 'cross_repository_review',
                bindings: {
                  workingFolderFrom: 'review_wave.plan_host_root',
                  input: { review_wave: 'review_wave' },
                },
              },
            ],
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
  });

  test('subflow wave rejects duplicate group ids and invalid binding paths', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'subflowWave',
            groups: [
              {
                kind: 'singleton',
                id: 'duplicate',
                flowName: 'one',
              },
              {
                kind: 'singleton',
                id: 'duplicate',
                flowName: 'two',
                bindings: { workingFolderFrom: 'bad path' },
              },
            ],
          },
        ],
      }),
    );

    assert.equal(parsed.ok, false);
  });

  test('subflow wave rejects duplicate matrix flow names', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'subflowWave',
            groups: [
              {
                kind: 'matrix',
                id: 'matrix',
                itemsFrom: 'items',
                itemName: 'item',
                flowNames: ['same', 'same'],
              },
            ],
          },
        ],
      }),
    );

    assert.equal(parsed.ok, false);
  });

  test('valid codexReview step parses as ok: true', () => {
    const json = JSON.stringify({
      description: 'Codex review flow',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step_or_agent',
          agentType: 'review_agent_heavy',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
  });

  test('agent-backed codexReview requires an agentType', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'codexReview',
            outputKey: 'current-codex-review',
            modelSource: 'flow_request_or_step_or_agent',
          },
        ],
      }),
    );

    assert.equal(parsed.ok, false);
  });

  test('codexReview agentType requires agent-backed modelSource', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'codexReview',
            outputKey: 'current-codex-review',
            modelSource: 'flow_request_or_step',
            agentType: 'review_agent_heavy',
          },
        ],
      }),
    );

    assert.equal(parsed.ok, false);
  });

  test('valid prepareReviewBase step parses as ok: true', () => {
    const json = JSON.stringify({
      description: 'Prepare shared review base',
      steps: [
        {
          type: 'prepareReviewBase',
          label: 'Prepare Shared Review Base',
          outputKey: 'current-review-base',
          basePolicy: 'branched_from_or_default_if_merged',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
  });

  test('valid prepareReviewTargets step parses as ok: true', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'prepareReviewTargets',
            label: 'Snapshot review targets',
            outputKey: 'review_wave',
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
  });

  test('validateReviewArtifacts accepts one pointer with canonical fallback', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'validateReviewArtifacts',
            pointerKeys: ['current-review'],
            ensureCanonicalFallback: true,
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
  });

  test('validateReviewArtifacts still requires at least one pointer', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'validateReviewArtifacts',
            pointerKeys: [],
            ensureCanonicalFallback: true,
          },
        ],
      }),
    );

    assert.equal(parsed.ok, false);
  });

  test('valid validateReviewTarget step parses as ok: true', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'validateReviewTarget',
            targetFrom: 'target',
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
  });

  test('subflow step requires non-empty flowNames entries', () => {
    const json = JSON.stringify({
      description: 'Subflow parent',
      steps: [
        {
          type: 'subflow',
          label: 'Run child',
          flowNames: ['   '],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('subflow step rejects duplicate flowNames', () => {
    const json = JSON.stringify({
      description: 'Subflow parent',
      steps: [
        {
          type: 'subflow',
          label: 'Run child',
          flowNames: ['child-flow', 'child-flow'],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('invalid JSON returns ok: false', () => {
    const parsed = parseFlowFile('{ not valid json');
    assert.equal(parsed.ok, false);
  });

  test('production review and implementation flows remain valid JSON and schema', async () => {
    const flowFiles = [
      'flows/codex_review.json',
      'flows/cross_repository_review.json',
      'flows/minor_review_fix_path.json',
      'flows/review_artifacts_main.json',
      'flows/review_disposition_current_artifacts.json',
      'flows/review_plan.json',
      'flows/review_task_up_path.json',
      'flows/two_phase_review_cycle.json',
      'flows/implement_next_plan.json',
      'flows/ingest_external_review_plan.json',
      'flows/improve_task_implement_plan.json',
      'flows/task_and_implement_plan.json',
    ] as const;

    for (const relativePath of flowFiles) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      assert.doesNotThrow(() => JSON.parse(raw), relativePath);

      const parsed = parseFlowFile(raw, {
        flowName: path.basename(relativePath),
      });
      assert.equal(parsed.ok, true, relativePath);
    }
  });

  test('two-phase review uses repeated 2N+1 fast waves before one N-only slow wave', async () => {
    const raw = await fs.readFile(
      path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    const topLevel = parsed.steps ?? [];
    const fastLoop = topLevel.find(
      (step) => step.label === 'Fast Review Convergence Loop',
    );
    const fastSteps = fastLoop?.steps ?? [];
    const fastSet = fastSteps.find((step) => step.type === 'prepareReviewSet');
    const fastWave = fastSteps.find((step) => step.type === 'subflowWave');
    const slowSet = topLevel.find(
      (step) => step.label === 'Prepare Slow Review Set',
    );
    const slowWaves = topLevel.filter(
      (step) => step.label === 'Run Slow Review Wave',
    );

    assert.equal(fastSet?.reviewPhase, 'fast');
    assert.deepEqual(fastSet?.reviewFlowNames, [
      'codex_review',
      'open_code_review',
    ]);
    assert.equal(fastSet?.crossRepositoryFlowName, 'cross_repository_review');
    assert.equal(
      fastSteps.some(
        (step) =>
          step.label ===
          'Load planner context before merging fast review findings',
      ),
      true,
    );
    assert.equal(
      fastSteps.some((step) => step.type === 'validateReviewArtifacts'),
      false,
    );
    assert.ok(
      fastWave?.groups?.some(
        (group) =>
          group.kind === 'matrix' &&
          group.flowNames?.join(',') === 'codex_review,open_code_review',
      ),
    );
    assert.ok(
      fastWave?.groups?.some(
        (group) =>
          group.kind === 'singleton' &&
          group.flowName === 'cross_repository_review',
      ),
    );
    assert.equal(slowSet?.reviewPhase, 'slow');
    assert.deepEqual(slowSet?.reviewFlowNames, ['review_artifacts_main']);
    assert.equal(slowSet?.crossRepositoryFlowName, undefined);
    assert.equal(slowWaves.length, 1);
    assert.deepEqual(slowWaves[0]?.groups, [
      {
        kind: 'matrix',
        id: 'slow_target_reviews',
        itemsFrom: 'slow_review_wave.targets',
        itemName: 'target',
        flowNames: ['review_artifacts_main'],
        bindings: {
          workingFolderFrom: 'target.repo_root',
          input: {
            target: 'target',
            review_wave: 'slow_review_wave',
            review_set: 'slow_review_set',
          },
        },
      },
    ]);
  });

  test('minor-fix audit tasks publish after each loop and refresh after combined task-up', async () => {
    const minorRaw = await fs.readFile(
      path.join(repoRoot, 'flows/minor_review_fix_path.json'),
      'utf8',
    );
    const minorFlow = JSON.parse(minorRaw) as { steps?: FlowStep[] };
    const minorSteps = minorFlow.steps ?? [];
    assert.equal(minorSteps[0]?.label, 'Minor Review Fix Path');
    assert.equal(
      minorSteps[1]?.markdownFile,
      'generate_or_update_minor_fix_audit_task.md',
    );

    const twoPhaseRaw = await fs.readFile(
      path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
      'utf8',
    );
    const twoPhase = JSON.parse(twoPhaseRaw) as { steps?: FlowStep[] };
    const labels = (twoPhase.steps ?? []).map((step) => step.label);
    assertOrdered(
      labels,
      'Resolve Slow Review Minor Findings',
      'Finalize Two-Phase Review Disposition',
    );
    assertOrdered(
      labels,
      'Task Up Combined Review Findings',
      'Refresh Minor-Fix Audit Task Coverage',
    );

    for (const relativePath of [
      'flows/review_plan.json',
      'flows/ingest_external_review_plan.json',
    ]) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      const flattened = flattenSteps(parsed.steps ?? []);
      const markers = flattened.map((step) => step.markdownFile);
      assert.ok(
        markers.indexOf('document_minor_review_fix.md') <
          markers.indexOf('generate_or_update_minor_fix_audit_task.md'),
        `${relativePath} should generate the audit after terminal outcomes`,
      );
      assert.ok(
        markers.indexOf('ensure_review_findings_became_tasks.md') <
          markers.indexOf('refresh_minor_fix_audit_task_coverage.md'),
        `${relativePath} should refresh audit coverage after task-up`,
      );
    }
  });

  test('implement_next_plan resets implementation agents only at safe boundaries and reloads compact context', async () => {
    const raw = await fs.readFile(
      path.join(repoRoot, 'flows/implement_next_plan.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    const steps = flattenSteps(parsed.steps ?? []);
    const resetSteps = steps.filter((step) => step.type === 'reset');
    const implementationResetSteps = resetSteps.filter(
      (step) =>
        step.label?.includes('story execution pass') === true ||
        step.label?.includes('completed task') === true,
    );

    assert.equal(implementationResetSteps.length, 10);
    for (const [agentType, identifier] of [
      ['planning_agent', 'planner'],
      ['coding_agent_lite', 'lite_coder'],
      ['coding_agent', 'coder'],
      ['automated_testing_agent', 'automated_tester'],
      ['manual_testing_agent', 'manual_tester'],
    ] as const) {
      assert.equal(
        implementationResetSteps.filter(
          (step) =>
            step.agentType === agentType && step.identifier === identifier,
        ).length,
        2,
        `${agentType}:${identifier} should reset at the story-pass and completed-task boundaries`,
      );
    }
    assert.equal(
      resetSteps.some((step) => step.identifier === 'loop_controller'),
      false,
    );
    assert.equal(
      implementationResetSteps.some(
        (step) => step.identifier === 'planner_lite',
      ),
      false,
    );
    assert.equal(
      steps.some((step) => step.label === 'Double-check plan'),
      false,
    );
    assert.equal(
      steps.some(
        (step) =>
          step.markdownFile === 'use_current_plan_handoff.md' ||
          step.markdownFile === 'manual_tester_use_current_plan_handoff.md',
      ),
      false,
    );
    assert.deepEqual(
      (parsed.steps ?? []).slice(0, 2).map((step) => step.label),
      ['Planner Select And Store Next Plan', 'Story Execution And Review Loop'],
    );

    const labels = steps.map((step) => step.label);
    assertOrdered(
      labels,
      'Exit task loop if story is complete',
      'Reset planner after completed task',
    );
    assertOrdered(
      labels,
      'Reset manual tester after completed task',
      'Reload planner story context after completed task',
    );

    const contextFiles = steps
      .map((step) => step.markdownFile)
      .filter((value): value is string => typeof value === 'string')
      .filter(
        (value) =>
          value.startsWith('load_') && !value.endsWith('_review_context.md'),
      );
    assert.deepEqual(
      contextFiles.sort(),
      [
        'load_automated_tester_current_task_context.md',
        'load_coder_current_task_context.md',
        'load_coder_current_task_context.md',
        'load_lite_coder_current_task_context.md',
        'load_manual_tester_current_task_context.md',
        'load_planner_story_context.md',
        'load_planner_story_context.md',
      ].sort(),
    );
  });

  test('main implementation flows share the canonical execution, review, and closeout suffix', async () => {
    const canonicalPath = 'flows/implement_next_plan.json';
    const canonicalRaw = await fs.readFile(
      path.join(repoRoot, canonicalPath),
      'utf8',
    );
    const canonical = JSON.parse(canonicalRaw) as { steps?: FlowStep[] };
    const canonicalSteps = canonical.steps ?? [];
    const canonicalLoopIndex = canonicalSteps.findIndex(
      (step) => step.label === 'Story Execution And Review Loop',
    );
    assert.notEqual(
      canonicalLoopIndex,
      -1,
      `${canonicalPath} should define the story loop`,
    );
    const canonicalSuffix = canonicalSteps.slice(canonicalLoopIndex);
    const staleOrientationLabels = [
      'Heavy Coder Use Next Plan',
      'Lite Coder Use Next Plan',
      'Manual Tester Use Next Plan',
    ];
    const canonicalSuffixLabels = flattenSteps(canonicalSuffix).map(
      (step) => step.label,
    );
    for (const staleLabel of staleOrientationLabels) {
      assert.equal(
        canonicalSuffixLabels.includes(staleLabel),
        false,
        `${canonicalPath} should not contain stale orientation step ${staleLabel}`,
      );
    }

    for (const relativePath of [
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ]) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      const steps = parsed.steps ?? [];
      const loopIndex = steps.findIndex(
        (step) => step.label === 'Story Execution And Review Loop',
      );
      assert.notEqual(
        loopIndex,
        -1,
        `${relativePath} should define the story loop`,
      );
      assert.deepEqual(
        steps.slice(loopIndex),
        canonicalSuffix,
        `${relativePath} should share the canonical execution, review, and closeout suffix`,
      );
      const prefixLabels = steps.slice(0, loopIndex).map((step) => step.label);
      for (const staleLabel of staleOrientationLabels) {
        assert.equal(
          prefixLabels.includes(staleLabel),
          false,
          `${relativePath} should not orient ${staleLabel} immediately before resetting that agent`,
        );
      }
    }
  });

  test('two-phase review helpers reset review agents at review-owned boundaries', async () => {
    const helperFiles = [
      'flows/review_disposition_current_artifacts.json',
      'flows/minor_review_fix_path.json',
    ];
    const helperSteps = await Promise.all(
      helperFiles.map(async (relativePath) => {
        const raw = await fs.readFile(
          path.join(repoRoot, relativePath),
          'utf8',
        );
        const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
        return flattenSteps(parsed.steps ?? []);
      }),
    );
    const steps = helperSteps.flat();
    const labels = steps.map((step) => step.label);
    const reviewResetSteps = steps.filter(
      (step) =>
        step.type === 'reset' &&
        (step.label?.includes('review disposition pass') === true ||
          step.label?.includes('minor review finding') === true),
    );

    assert.deepEqual(
      reviewResetSteps.map((step) => step.identifier),
      ['planner', 'planner_lite', 'coder'],
    );
    assertOrdered(
      labels,
      'Reset lite planner for current review disposition pass',
      'Load planner review context',
    );
    assertOrdered(
      labels,
      'Filter Review Findings To Story Scope',
      'Promote Actionable Review Findings To Minor Path',
    );
    assertOrdered(
      labels,
      'Promote Actionable Review Findings To Minor Path',
      'Record Review Issue Decisions In Plan',
    );
    assertOrdered(
      labels,
      'Record Review Issue Decisions In Plan',
      'Verify Review Issue Decisions Were Recorded',
    );
    assertOrdered(
      labels,
      'Verify Review Issue Decisions Were Recorded',
      'Retry Review Decisions Against Current Artifacts Unless Ready',
    );
    assertOrdered(
      labels,
      'Exit Minor-Fix Path Unless Minor Findings Remain',
      'Reset coder for next minor review finding',
    );
    assertOrdered(
      labels,
      'Load coder review context',
      'Implement Next Minor Review Finding',
    );

    const reviewContextFiles = steps
      .map((step) => step.markdownFile)
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => value.endsWith('_review_context.md'));
    assert.deepEqual(reviewContextFiles, [
      'load_planner_review_context.md',
      'load_lite_planner_review_context.md',
      'load_coder_review_context.md',
    ]);
    assert.equal(
      reviewResetSteps.some((step) => step.identifier?.startsWith('reviewer_')),
      false,
    );
  });

  test('review flows run findings saturation before blind-spot challenge', async () => {
    const flowFiles = [
      {
        relativePath: 'flows/review_plan.json',
        findingsCommand: 'code_review_findings',
        saturationCommand: 'review_findings_saturation',
        challengeCommand: 'review_blind_spot_challenge',
      },
      {
        relativePath: 'flows/review_artifacts_main.json',
        findingsCommand: 'target_code_review_findings',
        saturationCommand: 'target_review_findings_saturation',
        challengeCommand: 'target_review_blind_spot_challenge',
      },
      {
        relativePath: 'flows/implement_next_plan.json',
        findingsCommand: 'code_review_findings',
        saturationCommand: 'review_findings_saturation',
        challengeCommand: 'review_blind_spot_challenge',
      },
      {
        relativePath: 'flows/task_and_implement_plan.json',
        findingsCommand: 'code_review_findings',
        saturationCommand: 'review_findings_saturation',
        challengeCommand: 'review_blind_spot_challenge',
      },
      {
        relativePath: 'flows/improve_task_implement_plan.json',
        findingsCommand: 'code_review_findings',
        saturationCommand: 'review_findings_saturation',
        challengeCommand: 'review_blind_spot_challenge',
      },
      {
        relativePath: 'flows/ingest_external_review_plan.json',
        findingsCommand: 'external_review_findings',
        saturationCommand: 'external_review_findings_saturation',
        challengeCommand: 'external_review_blind_spot_challenge',
      },
    ] as const;

    for (const flowFile of flowFiles) {
      const raw = await fs.readFile(
        path.join(repoRoot, flowFile.relativePath),
        'utf8',
      );
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      assert.ok(
        Array.isArray(parsed.steps),
        `${flowFile.relativePath} should define steps`,
      );

      const commands = flattenSteps(parsed.steps ?? [])
        .map((step) => (step.type === 'command' ? step.commandName : undefined))
        .filter(
          (commandName): commandName is string =>
            typeof commandName === 'string',
        );

      if (
        [
          'flows/implement_next_plan.json',
          'flows/task_and_implement_plan.json',
          'flows/improve_task_implement_plan.json',
        ].includes(flowFile.relativePath)
      ) {
        const subflowMarkers = flattenSteps(parsed.steps ?? [])
          .filter((step) => step.type === 'subflow')
          .map((step) => (step.flowNames ?? []).join(','));
        assert.ok(
          subflowMarkers.includes('two_phase_review_cycle'),
          `${flowFile.relativePath} should launch the shared two-phase review cycle`,
        );
        continue;
      }

      const findingsIndex = commands.indexOf(flowFile.findingsCommand);
      const saturationIndex = commands.indexOf(flowFile.saturationCommand);
      const challengeIndex = commands.indexOf(flowFile.challengeCommand);

      assert.notEqual(
        findingsIndex,
        -1,
        `${flowFile.relativePath} should include findings step`,
      );
      assert.notEqual(
        saturationIndex,
        -1,
        `${flowFile.relativePath} should include findings saturation step`,
      );
      assert.notEqual(
        challengeIndex,
        -1,
        `${flowFile.relativePath} should include blind-spot challenge step`,
      );
      assert.ok(
        findingsIndex < saturationIndex && saturationIndex < challengeIndex,
        `${flowFile.relativePath} should run findings, then saturation, then challenge`,
      );
    }
  });

  test('target-local review commands start with the single-target contract and omit cross-repository prompt modules', async () => {
    const commandFiles = [
      'codeinfo_agents/review_agent/commands/target_review_evidence_gate.json',
      'codeinfo_agents/review_agent/commands/target_code_review_findings.json',
      'codeinfo_agents/review_agent_lite/commands/target_review_findings_saturation.json',
      'codeinfo_agents/review_agent_lite/commands/target_review_blind_spot_challenge.json',
    ];
    for (const commandFile of commandFiles) {
      const command = JSON.parse(
        await fs.readFile(path.join(repoRoot, commandFile), 'utf8'),
      ) as { items?: Array<{ markdownFile?: string }> };
      const markdownFiles = (command.items ?? []).map(
        (item) => item.markdownFile,
      );
      assert.equal(markdownFiles[0], 'single_target_review_contract.md');
      assert.equal(
        markdownFiles.some((file) => file?.includes('cross-repo')),
        false,
      );
    }
  });

  test('review flows use reset and classifier disposition before findings repair and scoped task-up', async () => {
    const flowFiles = [
      'flows/review_plan.json',
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
      'flows/ingest_external_review_plan.json',
    ] as const;

    for (const flowFile of flowFiles) {
      const markers = (await loadExpandedFlowSteps(flowFile)).map((step) => {
        if (step.type === 'llm') {
          return step.markdownFile;
        }
        if (step.type === 'command') {
          return step.commandName;
        }
        return undefined;
      });

      const resetIndex = markers.indexOf('reset_review_cycle_state.md');
      const classifyIndex = markers.indexOf('classify_review_disposition.md');
      const ensureIndex = markers.indexOf(
        'ensure_review_findings_became_tasks.md',
      );
      const taskUpIndex = markers.indexOf('task_up_review_tasks');

      assert.notEqual(
        resetIndex,
        -1,
        `${flowFile} should include review-cycle reset`,
      );
      assert.notEqual(
        classifyIndex,
        -1,
        `${flowFile} should include classifier disposition`,
      );
      assert.notEqual(
        ensureIndex,
        -1,
        `${flowFile} should include review findings repair`,
      );
      assert.notEqual(
        taskUpIndex,
        -1,
        `${flowFile} should include scoped review task-up`,
      );
      assert.ok(
        resetIndex < classifyIndex &&
          classifyIndex < ensureIndex &&
          ensureIndex < taskUpIndex,
        `${flowFile} should run reset, then classifier disposition, then repair findings tasks, then scoped task-up`,
      );
    }
  });

  test('main implementation flows include story and review repair steps', async () => {
    const flowFiles = [
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ] as const;

    for (const flowFile of flowFiles) {
      const markers = (await loadExpandedFlowSteps(flowFile))
        .map((step) => step.markdownFile)
        .filter((marker): marker is string => typeof marker === 'string');

      assert.ok(
        markers.includes('repair_story_workflow_state.md'),
        `${flowFile} should include story-scope repair`,
      );
      assert.ok(
        markers.includes('repair_review_workflow_state.md'),
        `${flowFile} should include review-state repair`,
      );
    }
  });

  test('main implementation flows scope-audit review-created tasks before simple-story refresh', async () => {
    const flowFiles = [
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ] as const;

    for (const flowFile of flowFiles) {
      const markers = (await loadExpandedFlowSteps(flowFile)).map((step) => {
        if (step.type === 'llm') {
          return step.markdownFile;
        }
        if (step.type === 'break' && 'label' in step) {
          return step.label;
        }
        return undefined;
      });

      const ensureTestingIndex = markers.indexOf(
        'ensure_task_testing_matches_current_contract.md',
      );
      const preflightScopeIndex = markers.indexOf(
        'Exit Review-Created Task Scope Loop If Context Is Not Safely Usable',
      );
      const repairScopeIndex = markers.indexOf(
        'repair_review_created_task_scope.md',
      );
      const verifyScopeIndex = markers.indexOf(
        'Exit Review-Created Task Scope Loop When Clean',
      );
      const simpleStoryIndex = markers.indexOf(
        'task_up/15-create-or-update-simple-story.md',
      );

      assert.notEqual(
        ensureTestingIndex,
        -1,
        `${flowFile} should normalize review-created testing before scope audit`,
      );
      assert.notEqual(
        preflightScopeIndex,
        -1,
        `${flowFile} should preflight review-created task scope loop context`,
      );
      assert.notEqual(
        repairScopeIndex,
        -1,
        `${flowFile} should repair review-created task scope`,
      );
      assert.notEqual(
        verifyScopeIndex,
        -1,
        `${flowFile} should verify review-created task scope before leaving task-up`,
      );
      assert.notEqual(
        simpleStoryIndex,
        -1,
        `${flowFile} should refresh the simple story after scope audit`,
      );
      assert.ok(
        ensureTestingIndex < preflightScopeIndex &&
          preflightScopeIndex < repairScopeIndex &&
          repairScopeIndex < verifyScopeIndex &&
          verifyScopeIndex < simpleStoryIndex,
        `${flowFile} should preflight and scope-audit review-created tasks after testing normalization and before simple-story refresh`,
      );
    }
  });

  test('main implementation flows filter review findings immediately after classifier disposition', async () => {
    const flowFiles = [
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ] as const;

    for (const flowFile of flowFiles) {
      const markers = (await loadExpandedFlowSteps(flowFile)).map((step) => {
        if (step.type === 'llm') {
          return step.markdownFile;
        }
        if (step.type === 'command') {
          return step.commandName;
        }
        return undefined;
      });

      const classifyIndex = markers.indexOf('classify_review_disposition.md');
      const filterIndex = markers.indexOf(
        'filter_review_findings_to_story_scope.md',
      );
      const ensureIndex = markers.indexOf(
        'ensure_review_findings_became_tasks.md',
      );

      assert.notEqual(
        classifyIndex,
        -1,
        `${flowFile} should include classifier disposition`,
      );
      assert.notEqual(
        filterIndex,
        -1,
        `${flowFile} should include findings scope filter`,
      );
      assert.notEqual(
        ensureIndex,
        -1,
        `${flowFile} should include review findings repair`,
      );
      assert.ok(
        classifyIndex < filterIndex && filterIndex < ensureIndex,
        `${flowFile} should run classifier disposition, then scope-filter findings, then repair tasked findings`,
      );
    }
  });

  test('implement_next_plan promotes scope-approved actionable findings before the minor path', async () => {
    const markers = (
      await loadExpandedFlowSteps('flows/implement_next_plan.json')
    ).map((step) => {
      if (step.type === 'llm') {
        return step.markdownFile;
      }
      if (step.type === 'command') {
        return step.commandName;
      }
      if (step.type === 'subflow') {
        return (step as { flowNames?: string[] }).flowNames?.join(',');
      }
      return step.type;
    });

    const prepareIndex = markers.indexOf('prepareReviewTargets');
    const parallelReviewSubflowIndex = markers.indexOf('subflowWave');
    const validationIndex = markers.indexOf('validateReviewWave');
    const mergeIndex = markers.indexOf(
      'merge_codex_review_findings_into_canonical_review.md',
    );
    const ocrMergeIndex = markers.indexOf(
      'merge_open_code_review_findings_into_canonical_review.md',
    );
    const classifyIndex = markers.indexOf('classify_review_disposition.md');
    const filterIndex = markers.indexOf(
      'filter_review_findings_to_story_scope.md',
    );
    const promoteIndex = markers.indexOf(
      'promote_actionable_review_findings_to_minor_path.md',
    );
    const recordDecisionsIndex = markers.indexOf(
      'record_review_issue_decisions_in_plan.md',
    );
    const verifyDecisionsIndex = markers.indexOf(
      'verify_review_issue_decisions_recorded.md',
    );
    const minorFixIndex = markers.indexOf('fix_next_minor_review_finding.md');

    assert.notEqual(
      prepareIndex,
      -1,
      'flows/implement_next_plan.json should snapshot review targets',
    );
    assert.notEqual(
      parallelReviewSubflowIndex,
      -1,
      'flows/implement_next_plan.json should include the mixed review wave',
    );
    assert.notEqual(
      validationIndex,
      -1,
      'flows/implement_next_plan.json should validate the joined review wave',
    );
    assert.notEqual(
      mergeIndex,
      -1,
      'flows/implement_next_plan.json should merge Codex review findings',
    );
    assert.notEqual(
      ocrMergeIndex,
      -1,
      'flows/implement_next_plan.json should merge Open Code Review findings',
    );
    assert.notEqual(
      classifyIndex,
      -1,
      'flows/implement_next_plan.json should include classifier disposition',
    );
    assert.notEqual(
      filterIndex,
      -1,
      'flows/implement_next_plan.json should include findings scope filter',
    );
    assert.notEqual(
      promoteIndex,
      -1,
      'flows/implement_next_plan.json should promote actionable findings into the minor path',
    );
    assert.notEqual(
      recordDecisionsIndex,
      -1,
      'flows/implement_next_plan.json should record review issue decisions before implementation',
    );
    assert.notEqual(
      verifyDecisionsIndex,
      -1,
      'flows/implement_next_plan.json should verify review issue decisions before implementation',
    );
    assert.notEqual(
      minorFixIndex,
      -1,
      'flows/implement_next_plan.json should include the minor finding fix step',
    );
    assert.ok(
      prepareIndex < parallelReviewSubflowIndex &&
        parallelReviewSubflowIndex < validationIndex &&
        validationIndex < mergeIndex &&
        mergeIndex < ocrMergeIndex &&
        ocrMergeIndex < classifyIndex &&
        classifyIndex < filterIndex &&
        filterIndex < promoteIndex &&
        promoteIndex < recordDecisionsIndex &&
        recordDecisionsIndex < verifyDecisionsIndex &&
        verifyDecisionsIndex < minorFixIndex,
      'flows/implement_next_plan.json should prepare one session, run three reviews, validate, merge both supplemental reviews, classify, scope-filter, promote actionable findings, record and verify their decisions, and then attempt a minor fix',
    );
  });

  test('all review disposition flows filter and promote actionable findings before inline fixing', async () => {
    const flowFiles = [
      'flows/review_plan.json',
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
      'flows/ingest_external_review_plan.json',
    ] as const;

    for (const flowFile of flowFiles) {
      const flattened = await loadExpandedFlowSteps(flowFile);
      const markers = flattened.map((step) => step.markdownFile);
      const classifyIndex = markers.indexOf('classify_review_disposition.md');
      const filterIndex = markers.indexOf(
        'filter_review_findings_to_story_scope.md',
      );
      const promoteIndex = markers.indexOf(
        'promote_actionable_review_findings_to_minor_path.md',
      );
      const recordDecisionsIndex = markers.indexOf(
        'record_review_issue_decisions_in_plan.md',
      );
      const verifyDecisionsIndex = markers.indexOf(
        'verify_review_issue_decisions_recorded.md',
      );
      const readinessIndex = flattened.findIndex(
        (step) =>
          step.type === 'continue' &&
          [
            'Restart Review Pass Unless Issue Decisions Are Ready',
            'Retry Review Decisions Against Current Artifacts Unless Ready',
          ].includes(step.label ?? ''),
      );
      const fixIndex = markers.indexOf('fix_next_minor_review_finding.md');

      assert.notEqual(
        classifyIndex,
        -1,
        `${flowFile} should classify findings`,
      );
      assert.notEqual(filterIndex, -1, `${flowFile} should filter findings`);
      assert.notEqual(
        promoteIndex,
        -1,
        `${flowFile} should promote actionable findings`,
      );
      assert.notEqual(
        recordDecisionsIndex,
        -1,
        `${flowFile} should record review issue decisions`,
      );
      assert.notEqual(
        verifyDecisionsIndex,
        -1,
        `${flowFile} should verify review issue decisions`,
      );
      assert.notEqual(
        readinessIndex,
        -1,
        `${flowFile} should deterministically gate downstream review work`,
      );
      assert.notEqual(fixIndex, -1, `${flowFile} should attempt inline fixes`);
      const recordStep = flattened.find(
        (step) =>
          step.type === 'llm' &&
          step.markdownFile === 'record_review_issue_decisions_in_plan.md',
      );
      const verifyStep = flattened.find(
        (step) =>
          step.type === 'llm' &&
          step.markdownFile === 'verify_review_issue_decisions_recorded.md',
      );
      assert.equal(
        recordStep?.type === 'llm' ? recordStep.continueOnFailure : undefined,
        true,
        `${flowFile} should tolerate an exhausted recorder failure`,
      );
      assert.equal(
        verifyStep?.type === 'llm' ? verifyStep.continueOnFailure : undefined,
        true,
        `${flowFile} should tolerate an exhausted verifier failure`,
      );
      const readinessStep = flattened[readinessIndex];
      assert.equal(readinessStep?.continueOn, 'yes');
      assert.ok(
        classifyIndex < filterIndex &&
          filterIndex < promoteIndex &&
          promoteIndex < recordDecisionsIndex &&
          recordDecisionsIndex < verifyDecisionsIndex &&
          verifyDecisionsIndex < readinessIndex &&
          readinessIndex < fixIndex,
        `${flowFile} should classify, filter, promote, record and verify decisions, and then attempt findings`,
      );
    }
  });

  test('external adjudication is preserved before classification and plan recording', async () => {
    const raw = await fs.readFile(
      path.join(repoRoot, 'flows/ingest_external_review_plan.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    const flattened = flattenSteps(parsed.steps ?? []);
    const markers = flattened.map((step) => step.markdownFile);
    const preserveIndexes = markers
      .map((marker, index) =>
        marker === 'preserve_external_review_adjudication_trail.md'
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    const classifyIndex = markers.indexOf('classify_review_disposition.md');
    const recordIndex = markers.indexOf(
      'record_review_issue_decisions_in_plan.md',
    );

    assert.deepEqual(preserveIndexes.length, 1);
    assert.ok(
      preserveIndexes[0]! < classifyIndex && classifyIndex < recordIndex,
      'external adjudication should be complete before classification and recording',
    );
    const preserveStep = flattened[preserveIndexes[0]!];
    assert.equal(
      preserveStep?.continueOnFailure,
      true,
      'external adjudication bookkeeping failures should not stop classification',
    );
  });

  test('loop-based review flows generate final minor revalidation before clean closeout', async () => {
    const flowFiles = [
      'flows/review_plan.json',
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
      'flows/ingest_external_review_plan.json',
    ] as const;

    for (const flowFile of flowFiles) {
      const raw = await fs.readFile(path.join(repoRoot, flowFile), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      assert.ok(Array.isArray(parsed.steps), `${flowFile} should define steps`);

      const markers = flattenSteps(parsed.steps ?? []).map((step) =>
        step.type === 'llm' ? step.markdownFile : undefined,
      );

      const finalTaskIndex = markers.indexOf(
        'generate_or_update_minor_fix_revalidation_task.md',
      );
      const closeoutIndex = markers.indexOf(
        'write_review_no_findings_closeout.md',
      );

      assert.notEqual(
        finalTaskIndex,
        -1,
        `${flowFile} should include final minor-fix revalidation generation`,
      );
      assert.notEqual(
        closeoutIndex,
        -1,
        `${flowFile} should include clean review closeout`,
      );
      assert.ok(
        finalTaskIndex < closeoutIndex,
        `${flowFile} should generate final minor revalidation before clean closeout`,
      );
    }
  });

  test('unknown keys are rejected (strict), including reingest extras', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', sourceId: '/tmp/repo', extra: true }],
      extra: true,
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('startLoop requires non-empty steps', () => {
    const json = JSON.stringify({
      description: 'Loop flow',
      steps: [
        {
          type: 'startLoop',
          steps: [],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('breakOn only accepts yes or no', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'break',
          agentType: 'planning_agent',
          identifier: 'loop',
          question: 'Stop?',
          breakOn: 'maybe',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('continueOn only accepts yes or no', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'continue',
          agentType: 'planning_agent',
          identifier: 'loop',
          question: 'Skip?',
          continueOn: 'maybe',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('llm requires agentType, identifier, and an instruction source', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          identifier: 'main',
          messages: [{ role: 'user', content: ['Hello'] }],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('break requires agentType, identifier, question, and breakOn', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'break',
          agentType: 'planning_agent',
          identifier: 'loop',
          breakOn: 'yes',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('continue requires agentType, identifier, question, and continueOn', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'continue',
          agentType: 'planning_agent',
          identifier: 'loop',
          continueOn: 'yes',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('command requires agentType, identifier, and commandName', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'command',
          agentType: 'planning_agent',
          identifier: 'loop',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reset steps parse with an optional trimmed label', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'reset',
            label: '  Reset planner context  ',
            agentType: '  planning_agent  ',
            identifier: '  planner  ',
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.flow.steps[0], {
      type: 'reset',
      label: 'Reset planner context',
      agentType: 'planning_agent',
      identifier: 'planner',
    });
  });

  test('reset steps require non-empty agentType and identifier values', () => {
    for (const step of [
      { type: 'reset', identifier: 'planner' },
      { type: 'reset', agentType: 'planning_agent' },
      { type: 'reset', agentType: '   ', identifier: 'planner' },
      { type: 'reset', agentType: 'planning_agent', identifier: '   ' },
    ]) {
      const parsed = parseFlowFile(JSON.stringify({ steps: [step] }));
      assert.equal(parsed.ok, false);
    }
  });

  test('reset steps reject unsupported extra fields', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'reset',
            agentType: 'planning_agent',
            identifier: 'planner',
            preserveRuntime: true,
          },
        ],
      }),
    );

    assert.equal(parsed.ok, false);
  });

  test('continue steps parse when they use the expected shape', () => {
    const json = JSON.stringify({
      description: 'Loop flow',
      steps: [
        {
          type: 'startLoop',
          steps: [
            {
              type: 'continue',
              agentType: 'planning_agent',
              identifier: 'loop',
              question: 'Skip?',
              continueOn: 'yes',
            },
          ],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
  });

  test('messages require role user and non-empty content strings', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          messages: [{ role: 'assistant', content: ['Hello'] }],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('llm steps still parse when they use messages', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          messages: [{ role: 'user', content: ['Hello'] }],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.flow.steps[0], {
      type: 'llm',
      agentType: 'planning_agent',
      identifier: 'main',
      messages: [{ role: 'user', content: ['Hello'] }],
    });
  });

  test('llm steps parse when they use markdownFile', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [
        {
          type: 'llm',
          label: 'Architecture review',
          agentType: 'planning_agent',
          identifier: 'main',
          markdownFile: 'architecture/review.md',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.flow.steps[0], {
      type: 'llm',
      label: 'Architecture review',
      agentType: 'planning_agent',
      identifier: 'main',
      markdownFile: 'architecture/review.md',
    });
  });

  test('llm steps accept an optional boolean continueOnFailure flag', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          continueOnFailure: true,
          markdownFile: 'architecture/review.md',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(
      parsed.flow.steps[0]?.type === 'llm'
        ? parsed.flow.steps[0].continueOnFailure
        : undefined,
      true,
    );
  });

  test('llm steps reject a non-boolean continueOnFailure flag', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          continueOnFailure: 'yes',
          markdownFile: 'architecture/review.md',
        },
      ],
    });

    assert.equal(parseFlowFile(json).ok, false);
  });

  test('reingest steps parse with sourceId', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', sourceId: '/tmp/repo' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.flow.steps[0], {
      type: 'reingest',
      sourceId: '/tmp/repo',
    });
  });

  test('reingest steps parse with target working', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', target: 'working' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.flow.steps[0], {
      type: 'reingest',
      target: 'working',
    });
  });

  test('reingest steps parse with target plan_scope', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', target: 'plan_scope' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.flow.steps[0], {
      type: 'reingest',
      target: 'plan_scope',
    });
  });

  test('reingest-only flows parse successfully', () => {
    const json = JSON.stringify({
      description: 'Reingest only flow',
      steps: [
        { type: 'reingest', sourceId: '/tmp/repo-a' },
        { type: 'reingest', label: 'Refresh B', sourceId: '/tmp/repo-b' },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
  });

  test('reingest steps reject sourceId and target together', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', sourceId: '/tmp/repo', target: 'working' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest steps reject removed target current', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', target: 'current' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest steps reject removed target all', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', target: 'all' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest steps reject unsupported target values', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', target: 'latest' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest steps reject whitespace-only sourceId values', () => {
    const json = JSON.stringify({
      description: 'Sample flow',
      steps: [{ type: 'reingest', sourceId: '   ' }],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('type discriminator keeps reingest steps distinct from llm instruction fields', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'reingest',
          sourceId: '/tmp/repo',
          markdownFile: 'architecture/review.md',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('empty llm markdownFile returns ok: false', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          markdownFile: '',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('llm steps with messages and markdownFile return ok: false', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
          messages: [{ role: 'user', content: ['Hello'] }],
          markdownFile: 'architecture/review.md',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('llm steps with neither messages nor markdownFile return ok: false', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'main',
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('nested startLoop llm steps with messages and markdownFile return ok: false', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'startLoop',
          steps: [
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'nested',
              messages: [{ role: 'user', content: ['Hello'] }],
              markdownFile: 'architecture/review.md',
            },
          ],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('nested startLoop llm steps with neither messages nor markdownFile return ok: false', () => {
    const json = JSON.stringify({
      steps: [
        {
          type: 'startLoop',
          steps: [
            {
              type: 'llm',
              agentType: 'planning_agent',
              identifier: 'nested',
            },
          ],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('whitespace-only entries are rejected after trimming', () => {
    const json = JSON.stringify({
      description: '  Flow name  ',
      steps: [
        {
          type: 'llm',
          label: '  Step 1  ',
          agentType: 'planning_agent',
          identifier: 'main',
          messages: [{ role: 'user', content: ['   '] }],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, false);
  });

  test('trimming produces a clean flow object', () => {
    const json = JSON.stringify({
      description: '  Sample flow  ',
      steps: [
        {
          type: 'llm',
          label: '  Step 1  ',
          agentType: ' planning_agent ',
          identifier: ' main ',
          messages: [{ role: 'user', content: ['  first  ', ' second '] }],
        },
      ],
    });

    const parsed = parseFlowFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.flow.description, 'Sample flow');
    const step = parsed.flow.steps[0];
    assert.equal(step.label, 'Step 1');
    if (step.type !== 'llm') throw new Error('Unexpected step type');
    assert.equal(step.agentType, 'planning_agent');
    assert.equal(step.identifier, 'main');
    assert.equal('messages' in step, true);
    if (!('messages' in step)) return;
    assert.deepEqual(step.messages[0].content, ['first', 'second']);
  });

  test('emits Task 1 proof logs for accepted and rejected reingest targets', () => {
    resetStore();

    const accepted = parseFlowFile(
      JSON.stringify({
        description: 'Sample flow',
        steps: [{ type: 'reingest', target: 'plan_scope' }],
      }),
      {
        flowName: 'accepted-target',
        emitSchemaParseLogs: true,
      },
    );
    assert.equal(accepted.ok, true);

    const rejected = parseFlowFile(
      JSON.stringify({
        description: 'Sample flow',
        steps: [{ type: 'reingest', target: 'all' }],
      }),
      {
        flowName: 'rejected-target',
        emitSchemaParseLogs: true,
      },
    );
    assert.equal(rejected.ok, false);

    const logs = query({ text: 'DEV-0000052:T1:reingest-target-contract' });
    assert.equal(logs.length, 2);
    assert.equal(logs[0]?.context?.surface, 'flow');
    assert.equal(logs[0]?.context?.definitionName, 'accepted-target');
    assert.equal(logs[0]?.context?.definitionIndex, 0);
    assert.equal(logs[0]?.context?.outcome, 'accepted_supported_target');
    assert.equal(logs[0]?.context?.supportedTarget, 'plan_scope');
    assert.equal(logs[1]?.context?.surface, 'flow');
    assert.equal(logs[1]?.context?.definitionName, 'rejected-target');
    assert.equal(logs[1]?.context?.definitionIndex, 0);
    assert.equal(logs[1]?.context?.outcome, 'rejected_removed_target');
    assert.equal(logs[1]?.context?.removedTarget, 'all');
  });
});
