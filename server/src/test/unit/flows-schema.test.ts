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
    maxIterations?: number;
    question?: string;
    breakOn?: string;
    breakOnFailure?: boolean;
    continueOnFailure?: boolean;
    continueOn?: string;
    haltFlow?: boolean;
    exitFlow?: boolean;
    steps?: FlowStep[];
    commandName?: string;
    markdownFile?: string;
    flowNames?: string[];
    reviewFlowNames?: string[];
    pointerKeys?: string[];
    ensureCanonicalFallback?: boolean;
    reviewPhase?: string;
    mode?: string;
    crossRepositoryFlowName?: string;
    groups?: Array<{
      kind?: string;
      flowNames?: string[];
      flowName?: string;
      bindings?: {
        inputValues?: Record<string, unknown>;
      };
    }>;
    groupsFrom?: string;
    reviewWorkspace?: { snapshotFrom?: string };
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
        for (const group of step.groups ?? []) {
          const nestedFlowNames = [
            ...(group.flowNames ?? []),
            ...(group.flowName ? [group.flowName] : []),
          ];
          for (const flowName of nestedFlowNames) {
            expanded.push(
              ...(await loadExpandedFlowSteps(`flows/${flowName}.json`, [
                ...ancestors,
                relativePath,
              ])),
            );
          }
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

  test('retired codexReview publisher step is rejected', () => {
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
    assert.equal(parsed.ok, false);
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

  test('retired pointer-oriented prepareReviewBase step is rejected', () => {
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
    assert.equal(parsed.ok, false);
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

  test('retired pointer-oriented artifact validator step is rejected', () => {
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

    assert.equal(parsed.ok, false);
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

  test('retired provider-specific target validator step is rejected', () => {
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

    assert.equal(parsed.ok, false);
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
      'flows/diagnostic_review_cycle.json',
      'flows/minor_review_fix_path.json',
      'flows/review_artifacts_main.json',
      'flows/review_batch.json',
      'flows/review_disposition_current_artifacts.json',
      'flows/review_plan.json',
      'flows/review_task_up_path.json',
      'flows/two_phase_review_cycle.json',
      'flows/implement_current_plan.json',
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

  test('review policy uses generic repeated and one-shot batches without leaking scheduling classes', async () => {
    const raw = await fs.readFile(
      path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    const topLevel = parsed.steps ?? [];
    const initializer = topLevel[0];
    const repeatedLoop = topLevel.find(
      (step) => step.label === 'Repeated Review Group',
    );
    const repeatedBatch = repeatedLoop?.steps?.find(
      (step) => step.label === 'Run Repeated Generic Review Batch',
    );
    const repeatedExit = repeatedLoop?.steps?.find(
      (step) =>
        step.label ===
        'Exit Repeated Group When Current Batch Needs No Repair Re-review',
    );
    const oneShotBatches = topLevel.filter(
      (step) => step.label === 'Run One-Shot Generic Review Batch',
    );

    assert.equal(initializer?.type, 'initializeReviewCycle');
    assert.equal(initializer?.mode, 'final');
    assert.equal(repeatedLoop?.type, 'startLoop');
    assert.equal((repeatedLoop as { maxIterations?: number }).maxIterations, 5);
    assert.equal(
      repeatedExit?.type === 'break' ? repeatedExit.breakOnFailure : undefined,
      true,
    );
    assert.match(repeatedExit?.question ?? '', /every target repository/u);
    assert.match(repeatedExit?.question ?? '', /stronger attempt/u);
    assert.equal(oneShotBatches.length, 1);
    const serialized = JSON.stringify({ repeatedBatch, oneShotBatches });
    assert.match(serialized, /codex_review/u);
    assert.match(serialized, /open_code_review/u);
    assert.match(serialized, /cross_repository_review/u);
    assert.match(serialized, /review_artifacts_main/u);
    assert.doesNotMatch(serialized, /reviewPhase|"fast"|"slow"/u);
    assert.match(serialized, /review_batch/u);
  });

  test('generic review batch verifies, reconciles, scope filters, dispositions, applies optional stronger repair, and records in order', async () => {
    const raw = await fs.readFile(
      path.join(repoRoot, 'flows/review_batch.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    const labels = (parsed.steps ?? []).map((step) => step.label);
    assertOrdered(
      labels,
      'Run Configured Review Batch',
      'Verify And Recover Review Batch Jobs',
    );
    assertOrdered(
      labels,
      'Verify And Recover Review Batch Jobs',
      'Reconcile Review Batch',
    );
    assertOrdered(
      labels,
      'Reconcile Review Batch',
      'Audit Review Batch Reconciliation',
    );
    assertOrdered(
      labels,
      'Audit Review Batch Reconciliation',
      'Reset Review Batch Scope Filter',
    );
    assertOrdered(
      labels,
      'Reset Review Batch Scope Filter',
      'Filter Review Findings To Story Scope',
    );
    assertOrdered(
      labels,
      'Filter Review Findings To Story Scope',
      'Reset Review Batch Scope Auditor',
    );
    assertOrdered(
      labels,
      'Reset Review Batch Scope Auditor',
      'Audit Review Batch Scope Filter',
    );
    assertOrdered(
      labels,
      'Audit Review Batch Scope Filter',
      'Reset Review Batch Dispositioner',
    );
    assertOrdered(
      labels,
      'Reset Review Batch Dispositioner',
      'Disposition Review Batch',
    );
    const directFixIndex = labels.indexOf('Implement Direct Review Fixes');
    assert.ok(directFixIndex > 0);
    const directReset = (parsed.steps ?? [])[directFixIndex - 1];
    const directFix = (parsed.steps ?? [])[directFixIndex];
    assert.equal(directReset?.label, 'Reset Direct Review Fixer');
    assert.equal(directReset?.type, 'reset');
    assert.equal(directReset?.agentType, 'coding_agent');
    assert.equal(directReset?.identifier, 'batch_fixer');
    assert.equal(directFix?.type, 'llm');
    assert.equal(directFix?.agentType, directReset?.agentType);
    assert.equal(directFix?.identifier, directReset?.identifier);
    assert.equal(directFix?.continueOnFailure, true);
    assert.equal(
      directFix?.markdownFile,
      'implement_review_batch_direct_fixes.md',
    );
    assertOrdered(
      labels,
      'Implement Direct Review Fixes',
      'Optional Stronger Review Repair',
    );
    assertOrdered(
      labels,
      'Optional Stronger Review Repair',
      'Record Review Batch Outcome',
    );

    const scopeReset = (parsed.steps ?? []).find(
      (step) => step.label === 'Reset Review Batch Scope Filter',
    );
    const scopeFilter = (parsed.steps ?? []).find(
      (step) => step.label === 'Filter Review Findings To Story Scope',
    );
    assert.equal(scopeReset?.type, 'reset');
    assert.equal(scopeReset?.agentType, 'planning_agent');
    assert.equal(scopeReset?.identifier, 'batch_scope_filter');
    assert.equal(scopeFilter?.type, 'llm');
    assert.equal(scopeFilter?.agentType, 'planning_agent');
    assert.equal(scopeFilter?.identifier, 'batch_scope_filter');
    assert.equal(scopeFilter?.continueOnFailure, true);
    assert.equal(
      scopeFilter?.markdownFile,
      'filter_review_batch_findings_to_story_scope.md',
    );

    const scopeAuditReset = (parsed.steps ?? []).find(
      (step) => step.label === 'Reset Review Batch Scope Auditor',
    );
    const scopeAudit = (parsed.steps ?? []).find(
      (step) => step.label === 'Audit Review Batch Scope Filter',
    );
    assert.equal(scopeAuditReset?.type, 'reset');
    assert.equal(scopeAuditReset?.agentType, 'review_agent_heavy');
    assert.equal(scopeAuditReset?.identifier, 'batch_scope_auditor');
    assert.equal(scopeAudit?.type, 'llm');
    assert.equal(scopeAudit?.agentType, scopeAuditReset?.agentType);
    assert.equal(scopeAudit?.identifier, scopeAuditReset?.identifier);
    assert.equal(scopeAudit?.continueOnFailure, true);
    assert.equal(
      scopeAudit?.markdownFile,
      'audit_review_batch_scope_filter.md',
    );

    const dispositionIndex = labels.indexOf('Disposition Review Batch');
    assert.ok(dispositionIndex > 0);
    const dispositionReset = (parsed.steps ?? [])[dispositionIndex - 1];
    const disposition = (parsed.steps ?? [])[dispositionIndex];
    assert.equal(dispositionReset?.label, 'Reset Review Batch Dispositioner');
    assert.equal(dispositionReset?.type, 'reset');
    assert.equal(dispositionReset?.agentType, 'planning_agent');
    assert.equal(dispositionReset?.identifier, 'batch_dispositioner');
    assert.equal(disposition?.type, 'llm');
    assert.equal(disposition?.agentType, dispositionReset?.agentType);
    assert.equal(disposition?.identifier, dispositionReset?.identifier);
    assert.equal(disposition?.continueOnFailure, true);
    assert.equal(disposition?.markdownFile, 'disposition_review_batch.md');

    const outcome = (parsed.steps ?? []).find(
      (step) => step.label === 'Record Review Batch Outcome',
    );
    assert.equal(outcome?.agentType, 'planning_agent');
    assert.equal(outcome?.identifier, 'batch_dispositioner');

    const optionalRepair = (parsed.steps ?? []).find(
      (step) => step.label === 'Optional Stronger Review Repair',
    );
    assert.equal(optionalRepair?.type, 'startLoop');
    assert.equal(optionalRepair?.maxIterations, 1);
    const optionalSteps = optionalRepair?.steps ?? [];
    assert.deepEqual(
      optionalSteps.map((step) => step.label),
      [
        'Skip Stronger Repair When Normal Fixer Completed All Findings',
        'Reset Stronger Review Fixer',
        'Implement Remaining Review Fixes',
        'Reset Optional Repair Loop Controller',
        'Exit Optional Stronger Repair After One Attempt',
      ],
    );
    const completionGate = optionalSteps[0];
    assert.equal(completionGate?.type, 'break');
    assert.equal(completionGate?.agentType, 'coding_agent');
    assert.equal(completionGate?.identifier, 'batch_fixer');
    assert.equal(completionGate?.breakOn, 'yes');
    assert.equal(completionGate?.breakOnFailure, undefined);
    assert.match(completionGate?.question ?? '', /positively confirmed/u);
    assert.match(completionGate?.question ?? '', /evidence is uncertain/u);
    const strongerReset = optionalSteps[1];
    const strongerFix = optionalSteps[2];
    assert.equal(
      optionalSteps.indexOf(strongerFix) - optionalSteps.indexOf(strongerReset),
      1,
    );
    assert.equal(strongerReset?.type, 'reset');
    assert.equal(strongerReset?.agentType, 'research_agent');
    assert.equal(strongerReset?.identifier, 'batch_research_fixer');
    assert.equal(strongerFix?.type, 'llm');
    assert.equal(strongerFix?.agentType, strongerReset?.agentType);
    assert.equal(strongerFix?.identifier, strongerReset?.identifier);
    assert.equal(strongerFix?.continueOnFailure, true);
    assert.equal(
      strongerFix?.markdownFile,
      'implement_review_batch_remaining_fixes.md',
    );
    const exitGate = optionalSteps[4];
    assert.equal(exitGate?.type, 'break');
    assert.equal(exitGate?.agentType, 'loop_control_agent');
    assert.equal(exitGate?.breakOn, 'yes');
    assert.match(exitGate?.question ?? '', /single allowed invocation/u);
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

  test('main implementation flows share one bounded stronger blocker repair with a fresh research agent', async () => {
    const flowFiles = [
      'flows/implement_next_plan.json',
      'flows/implement_current_plan.json',
      'flows/improve_task_implement_plan.json',
      'flows/task_and_implement_plan.json',
    ] as const;
    let canonicalOptionalRepair: FlowStep | undefined;

    for (const relativePath of flowFiles) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      const implementationLoop = flattenSteps(parsed.steps ?? []).find(
        (step) => step.label === 'Implementation Loop',
      );
      assert.equal(implementationLoop?.type, 'startLoop', relativePath);
      const implementationSteps = implementationLoop?.steps ?? [];
      const labels = implementationSteps.map((step) => step.label);
      const contextLoadIndex = labels.indexOf(
        'Load coder current task context before implementation repair',
      );
      assert.ok(contextLoadIndex > 0, relativePath);
      const coderReset = implementationSteps[contextLoadIndex - 1];
      const contextLoad = implementationSteps[contextLoadIndex];
      assert.equal(
        coderReset?.label,
        'Reset coder before implementation repair',
        relativePath,
      );
      assert.equal(coderReset?.type, 'reset', relativePath);
      assert.equal(coderReset?.agentType, 'coding_agent', relativePath);
      assert.equal(coderReset?.identifier, 'coder', relativePath);
      assert.equal(contextLoad?.type, 'llm', relativePath);
      assert.equal(contextLoad?.agentType, coderReset?.agentType, relativePath);
      assert.equal(
        contextLoad?.identifier,
        coderReset?.identifier,
        relativePath,
      );
      const deepRepairIndex = labels.indexOf(
        'Deep repair implementation blocker',
      );
      assert.equal(deepRepairIndex, contextLoadIndex + 1, relativePath);
      const optionalRepair = implementationSteps[deepRepairIndex + 1];
      const authoritativeGate = implementationSteps[deepRepairIndex + 2];

      assert.equal(
        optionalRepair?.label,
        'Optional Stronger Implementation Blocker Repair',
        relativePath,
      );
      assert.equal(optionalRepair?.type, 'startLoop', relativePath);
      assert.equal(optionalRepair?.maxIterations, 1, relativePath);
      assert.equal(
        authoritativeGate?.label,
        'Implementation blocker remains',
        relativePath,
      );

      const optionalSteps = optionalRepair?.steps ?? [];
      assert.deepEqual(
        optionalSteps.map((step) => step.label),
        [
          'Skip Stronger Implementation Repair When Normal Repair Cleared Blocker',
          'Reset Stronger Implementation Blocker Repairer',
          'Research And Resolve Remaining Implementation Blocker',
          'Exit Optional Stronger Implementation Repair After One Attempt',
        ],
        relativePath,
      );

      const normalGate = optionalSteps[0];
      assert.equal(normalGate?.type, 'break', relativePath);
      assert.equal(normalGate?.agentType, 'coding_agent', relativePath);
      assert.equal(normalGate?.identifier, 'coder', relativePath);
      assert.equal(normalGate?.breakOn, 'yes', relativePath);
      assert.equal(normalGate?.breakOnFailure, undefined, relativePath);
      assert.match(normalGate?.question ?? '', /positively confirms/u);
      assert.match(normalGate?.question ?? '', /malformed, or uncertain/u);

      const strongerReset = optionalSteps[1];
      const strongerRepair = optionalSteps[2];
      assert.equal(strongerReset?.type, 'reset', relativePath);
      assert.equal(strongerReset?.agentType, 'research_agent', relativePath);
      assert.equal(
        strongerReset?.identifier,
        'implementation_blocker_researcher',
        relativePath,
      );
      assert.equal(strongerRepair?.type, 'llm', relativePath);
      assert.equal(
        strongerRepair?.agentType,
        strongerReset?.agentType,
        relativePath,
      );
      assert.equal(
        strongerRepair?.identifier,
        strongerReset?.identifier,
        relativePath,
      );
      assert.equal(strongerRepair?.continueOnFailure, true, relativePath);
      assert.equal(
        strongerRepair?.markdownFile,
        'research_implementation_blocker_repair.md',
        relativePath,
      );

      assert.equal(
        optionalSteps.some(
          (step) =>
            step.type === 'reset' && step.agentType === 'loop_control_agent',
        ),
        false,
        relativePath,
      );
      const explicitExit = optionalSteps[3];
      assert.equal(explicitExit?.type, 'break', relativePath);
      assert.equal(explicitExit?.agentType, 'loop_control_agent');
      assert.equal(
        explicitExit?.identifier,
        'implementation_research_loop_controller',
      );
      assert.equal(explicitExit?.breakOn, 'yes', relativePath);
      assert.match(explicitExit?.question ?? '', /single allowed invocation/u);

      if (canonicalOptionalRepair === undefined) {
        canonicalOptionalRepair = optionalRepair;
      } else {
        assert.deepEqual(optionalRepair, canonicalOptionalRepair, relativePath);
      }
    }
  });

  test('implement_current_plan preserves the persisted plan while retaining the canonical review path', async () => {
    const [currentRaw, nextRaw, repairPrompt] = await Promise.all([
      fs.readFile(
        path.join(repoRoot, 'flows/implement_current_plan.json'),
        'utf8',
      ),
      fs.readFile(
        path.join(repoRoot, 'flows/implement_next_plan.json'),
        'utf8',
      ),
      fs.readFile(
        path.join(
          repoRoot,
          'codeinfo_markdown/repair_current_plan_workflow_state.md',
        ),
        'utf8',
      ),
    ]);
    const current = JSON.parse(currentRaw) as { steps?: FlowStep[] };
    const next = JSON.parse(nextRaw) as { steps?: FlowStep[] };
    const currentSteps = current.steps ?? [];
    const nextSteps = next.steps ?? [];
    const storyLoopIndex = nextSteps.findIndex(
      (step) => step.label === 'Story Execution And Review Loop',
    );
    const flattened = flattenSteps(currentSteps);

    assert.equal(currentSteps[0]?.label, 'Story Execution And Review Loop');
    assert.equal(storyLoopIndex >= 0, true);
    assert.equal(
      flattened.some(
        (step) =>
          step.label === 'Planner Select And Store Next Plan' ||
          step.markdownFile === 'store_current_plan_handoff.md',
      ),
      false,
    );
    assert.equal(
      flattened.filter(
        (step) => step.markdownFile === 'repair_current_plan_workflow_state.md',
      ).length,
      4,
    );
    assert.equal(
      flattened.some(
        (step) => step.markdownFile === 'repair_story_workflow_state.md',
      ),
      false,
    );
    assert.equal(
      flattened.some(
        (step) =>
          step.type === 'subflow' &&
          step.flowNames?.includes('two_phase_review_cycle'),
      ),
      true,
    );

    const normalizeCurrentRepairPrompt = (steps: FlowStep[]): FlowStep[] =>
      steps.map((step) => ({
        ...step,
        ...(step.markdownFile === 'repair_current_plan_workflow_state.md'
          ? { markdownFile: 'repair_story_workflow_state.md' }
          : {}),
        ...(step.steps
          ? { steps: normalizeCurrentRepairPrompt(step.steps) }
          : {}),
      }));
    assert.deepEqual(
      normalizeCurrentRepairPrompt(currentSteps),
      nextSteps.slice(storyLoopIndex),
    );
    assert.match(repairPrompt, /retain its exact `plan_path`/u);
    assert.match(repairPrompt, /Never run next-plan discovery/u);
    assert.match(repairPrompt, /no different plan was selected/u);
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
        relativePath: 'flows/implement_current_plan.json',
        findingsCommand: 'code_review_findings',
        saturationCommand: 'review_findings_saturation',
        challengeCommand: 'review_blind_spot_challenge',
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

      if (flowFile.relativePath === 'flows/review_artifacts_main.json') {
        const markdownFiles = flattenSteps(parsed.steps ?? []).map(
          (step) => step.markdownFile,
        );
        const findingsIndex = markdownFiles.indexOf(
          'run_deep_review_findings_workspace.md',
        );
        const saturationIndex = markdownFiles.indexOf(
          'run_deep_review_saturation_workspace.md',
        );
        const challengeIndex = markdownFiles.indexOf(
          'run_deep_review_blindspot_workspace.md',
        );
        assert.ok(
          findingsIndex >= 0 &&
            findingsIndex < saturationIndex &&
            saturationIndex < challengeIndex,
          'workspace deep review should run findings, saturation, then blind-spot challenge',
        );
        continue;
      }

      if (
        [
          'flows/implement_next_plan.json',
          'flows/implement_current_plan.json',
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

  test('review flows initialize state before agent-native disposition and settlement tasking', async () => {
    const finalReviewFlowFiles = [
      'flows/implement_current_plan.json',
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ] as const;

    for (const flowFile of finalReviewFlowFiles) {
      const markers = (await loadExpandedFlowSteps(flowFile)).map((step) => {
        if (step.type === 'initializeReviewCycle') {
          return `initializeReviewCycle:${step.mode}`;
        }
        if (step.type === 'llm') {
          return step.markdownFile;
        }
        if (step.type === 'command') {
          return step.commandName;
        }
        return undefined;
      });

      const initializeIndex = markers.indexOf('initializeReviewCycle:final');
      const classifyIndex = markers.indexOf('disposition_review_batch.md');
      const ensureIndex = markers.indexOf('settle_agent_native_review_pass.md');
      const taskUpIndex = markers.indexOf(
        'apply_agent_native_review_settlement.md',
      );

      assert.notEqual(
        initializeIndex,
        -1,
        `${flowFile} should include native final review-cycle initialization`,
      );
      assert.equal(
        markers.includes('reset_review_cycle_state.md'),
        false,
        `${flowFile} should leave reset ownership to the review subflow`,
      );
      assert.notEqual(
        classifyIndex,
        -1,
        `${flowFile} should include workspace batch disposition`,
      );
      assert.notEqual(
        ensureIndex,
        -1,
        `${flowFile} should include complete-pass settlement`,
      );
      assert.notEqual(
        taskUpIndex,
        -1,
        `${flowFile} should apply settlement through agent tasking`,
      );
      assert.ok(
        initializeIndex < classifyIndex &&
          classifyIndex < ensureIndex &&
          ensureIndex < taskUpIndex,
        `${flowFile} should initialize, disposition generic output, settle the pass, and apply tasking`,
      );
    }

    const standaloneDispositionFlows = [
      'flows/review_plan.json',
      'flows/ingest_external_review_plan.json',
    ] as const;

    for (const flowFile of standaloneDispositionFlows) {
      const markers = (await loadExpandedFlowSteps(flowFile)).map(
        (step) => step.markdownFile,
      );
      const resetIndex = markers.indexOf('reset_review_cycle_state.md');
      const classifyIndex = markers.indexOf('classify_review_disposition.md');

      assert.notEqual(
        resetIndex,
        -1,
        `${flowFile} should retain its standalone reset`,
      );
      assert.ok(
        resetIndex < classifyIndex,
        `${flowFile} should reset before classifier disposition`,
      );
    }
  });

  test('main implementation flows include story repair and review settlement audit', async () => {
    const flowFiles = [
      'flows/implement_current_plan.json',
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ] as const;

    for (const flowFile of flowFiles) {
      const markers = (await loadExpandedFlowSteps(flowFile))
        .map((step) => step.markdownFile)
        .filter((marker): marker is string => typeof marker === 'string');

      const repairMarker =
        flowFile === 'flows/implement_current_plan.json'
          ? 'repair_current_plan_workflow_state.md'
          : 'repair_story_workflow_state.md';
      assert.ok(
        markers.includes(repairMarker),
        `${flowFile} should include story-scope repair`,
      );
      assert.ok(
        markers.includes('audit_agent_native_review_settlement.md'),
        `${flowFile} should include review settlement audit`,
      );
    }
  });

  test('main implementation flows apply and audit agent-native review settlement', async () => {
    const flowFiles = [
      'flows/implement_current_plan.json',
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

      const settleIndex = markers.indexOf('settle_agent_native_review_pass.md');
      const applyIndex = markers.indexOf(
        'apply_agent_native_review_settlement.md',
      );
      const auditIndex = markers.indexOf(
        'audit_agent_native_review_settlement.md',
      );
      assert.ok(
        settleIndex >= 0 && settleIndex < applyIndex && applyIndex < auditIndex,
        `${flowFile} should settle, apply tasking, then independently audit`,
      );
    }
  });

  test('main implementation flows reconcile before disposition and settlement', async () => {
    const flowFiles = [
      'flows/implement_current_plan.json',
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

      const reconcileIndex = markers.indexOf('reconcile_review_batch.md');
      const scopeFilterIndex = markers.indexOf(
        'filter_review_batch_findings_to_story_scope.md',
      );
      const dispositionIndex = markers.indexOf('disposition_review_batch.md');
      const ensureIndex = markers.indexOf('settle_agent_native_review_pass.md');

      assert.notEqual(
        reconcileIndex,
        -1,
        `${flowFile} should include directory-discovered reconciliation`,
      );
      assert.notEqual(
        scopeFilterIndex,
        -1,
        `${flowFile} should include independent story-scope filtering`,
      );
      assert.notEqual(
        dispositionIndex,
        -1,
        `${flowFile} should include agent disposition`,
      );
      assert.notEqual(
        ensureIndex,
        -1,
        `${flowFile} should include complete-pass settlement`,
      );
      assert.ok(
        reconcileIndex < scopeFilterIndex &&
          scopeFilterIndex < dispositionIndex &&
          dispositionIndex < ensureIndex,
        `${flowFile} should reconcile, scope filter, disposition, then settle findings`,
      );
    }
  });

  test('implement_next_plan uses agent-native review preparation, discovery, reconciliation, fixing, and settlement', async () => {
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
    const parallelReviewSubflowIndex = markers.findIndex(
      (marker, index) => marker === 'subflowWave' && index > prepareIndex,
    );
    const verifyIndex = markers.indexOf('verify_review_batch_jobs.md');
    const reconcileIndex = markers.indexOf('reconcile_review_batch.md');
    const scopeFilterIndex = markers.indexOf(
      'filter_review_batch_findings_to_story_scope.md',
    );
    const dispositionIndex = markers.indexOf('disposition_review_batch.md');
    const directFixIndex = markers.indexOf(
      'implement_review_batch_direct_fixes.md',
    );
    const strongerFixIndex = markers.indexOf(
      'implement_review_batch_remaining_fixes.md',
    );
    const settlementIndex = markers.indexOf(
      'settle_agent_native_review_pass.md',
    );
    const applyIndex = markers.indexOf(
      'apply_agent_native_review_settlement.md',
    );

    assert.notEqual(
      prepareIndex,
      -1,
      'flows/implement_next_plan.json should snapshot generic batch targets',
    );
    assert.notEqual(
      parallelReviewSubflowIndex,
      -1,
      'flows/implement_next_plan.json should include parallel review jobs',
    );
    assert.notEqual(
      verifyIndex,
      -1,
      'flows/implement_next_plan.json should verify and recover job directories',
    );
    assert.notEqual(
      reconcileIndex,
      -1,
      'flows/implement_next_plan.json should reconcile discovered job output',
    );
    assert.notEqual(
      scopeFilterIndex,
      -1,
      'flows/implement_next_plan.json should independently filter reconciled findings to story scope',
    );
    assert.notEqual(
      dispositionIndex,
      -1,
      'flows/implement_next_plan.json should disposition generic review output',
    );
    assert.notEqual(
      directFixIndex,
      -1,
      'flows/implement_next_plan.json should implement supported direct fixes',
    );
    assert.notEqual(
      strongerFixIndex,
      -1,
      'flows/implement_next_plan.json should include the optional stronger repair prompt',
    );
    assert.notEqual(
      settlementIndex,
      -1,
      'flows/implement_next_plan.json should settle the complete review pass',
    );
    assert.notEqual(
      applyIndex,
      -1,
      'flows/implement_next_plan.json should apply settlement tasking',
    );
    assert.ok(
      prepareIndex < parallelReviewSubflowIndex &&
        parallelReviewSubflowIndex < verifyIndex &&
        verifyIndex < reconcileIndex &&
        reconcileIndex < scopeFilterIndex &&
        scopeFilterIndex < dispositionIndex &&
        dispositionIndex < directFixIndex &&
        directFixIndex < strongerFixIndex &&
        strongerFixIndex < settlementIndex &&
        settlementIndex < applyIndex,
      'flows/implement_next_plan.json should prepare, run, verify, reconcile, scope filter, apply both repair levels, settle, and task generic review batches',
    );
  });

  test('all review disposition flows filter and promote actionable findings before inline fixing', async () => {
    const flowFiles = [
      'flows/review_plan.json',
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

  test('standalone review flows retain final minor revalidation before clean closeout', async () => {
    const flowFiles = [
      'flows/review_plan.json',
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

  test('startLoop accepts a positive integer maxIterations', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'startLoop',
            maxIterations: 5,
            steps: [
              {
                type: 'llm',
                agentType: 'coding_agent',
                identifier: 'bounded',
                messages: [{ role: 'user', content: ['Run once.'] }],
              },
            ],
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
  });

  test('startLoop rejects non-positive maxIterations', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'startLoop',
            maxIterations: 0,
            steps: [
              {
                type: 'llm',
                agentType: 'coding_agent',
                identifier: 'bounded',
                messages: [{ role: 'user', content: ['Run once.'] }],
              },
            ],
          },
        ],
      }),
    );

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

  test('break accepts haltFlow for terminal blocker gates', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'break',
            agentType: 'loop_control_agent',
            identifier: 'loop',
            question: 'Halt?',
            breakOn: 'yes',
            haltFlow: true,
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.flow.steps[0]?.type, 'break');
      assert.equal(
        parsed.flow.steps[0]?.type === 'break'
          ? parsed.flow.steps[0].haltFlow
          : undefined,
        true,
      );
    }
  });

  test('break accepts fail-forward loop exit behavior', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'break',
            agentType: 'loop_control_agent',
            identifier: 'loop',
            question: 'Exit after an unusable advisory response?',
            breakOn: 'yes',
            breakOnFailure: true,
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.flow.steps[0]?.type, 'break');
      assert.equal(
        parsed.flow.steps[0]?.type === 'break'
          ? parsed.flow.steps[0].breakOnFailure
          : undefined,
        true,
      );
    }
  });

  test('break accepts exitFlow for successful best-effort exits', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'break',
            agentType: 'loop_control_agent',
            identifier: 'loop',
            question: 'Exit successfully?',
            breakOn: 'yes',
            exitFlow: true,
          },
        ],
      }),
    );

    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.flow.steps[0]?.type, 'break');
      assert.equal(
        parsed.flow.steps[0]?.type === 'break'
          ? parsed.flow.steps[0].exitFlow
          : undefined,
        true,
      );
    }
  });

  test('break rejects simultaneous haltFlow and exitFlow', () => {
    const parsed = parseFlowFile(
      JSON.stringify({
        steps: [
          {
            type: 'break',
            agentType: 'loop_control_agent',
            identifier: 'loop',
            question: 'Choose one terminal behavior?',
            breakOn: 'yes',
            haltFlow: true,
            exitFlow: true,
          },
        ],
      }),
    );

    assert.equal(parsed.ok, false);
  });

  test('story implementation flows exit successfully instead of halting on durable blockers', async () => {
    for (const relativePath of [
      'flows/implement_current_plan.json',
      'flows/implement_next_plan.json',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ]) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      const blockerExit = flattenSteps(parsed.steps ?? []).find(
        (step) =>
          step.type === 'break' &&
          step.label ===
            'Exit story flow successfully while durable blocker remains',
      );

      assert.ok(blockerExit, `${relativePath} should define a blocker exit`);
      assert.equal(blockerExit.type, 'break');
      if (blockerExit.type === 'break') {
        assert.equal(blockerExit.exitFlow, true);
        assert.equal(blockerExit.haltFlow, undefined);
      }
    }
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
