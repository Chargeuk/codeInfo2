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
    steps?: FlowStep[];
    commandName?: string;
    markdownFile?: string;
    flowNames?: string[];
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

  test('valid codexReview step parses as ok: true', () => {
    const json = JSON.stringify({
      description: 'Codex review flow',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          reasoningEffort: 'high',
        },
      ],
    });

    const parsed = parseFlowFile(json);
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
      'flows/review_artifacts_main.json',
      'flows/review_plan.json',
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

      if (flowFile.relativePath === 'flows/implement_next_plan.json') {
        const subflowMarkers = flattenSteps(parsed.steps ?? [])
          .map((step) =>
            step.type === 'subflow' && Array.isArray((step as { flowNames?: string[] }).flowNames)
              ? (step as { flowNames: string[] }).flowNames.join(',')
              : undefined,
          )
          .filter((marker): marker is string => typeof marker === 'string');
        assert.ok(
          subflowMarkers.includes('review_artifacts_main,codex_review'),
          'flows/implement_next_plan.json should launch parallel review artifact subflows',
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

  test('review flows use reset and classifier disposition before findings repair and scoped task-up', async () => {
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

      const markers = flattenSteps(parsed.steps ?? []).map((step) => {
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
      const raw = await fs.readFile(path.join(repoRoot, flowFile), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      assert.ok(Array.isArray(parsed.steps), `${flowFile} should define steps`);

      const markers = flattenSteps(parsed.steps ?? [])
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
      const raw = await fs.readFile(path.join(repoRoot, flowFile), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      assert.ok(Array.isArray(parsed.steps), `${flowFile} should define steps`);

      const markers = flattenSteps(parsed.steps ?? []).map((step) => {
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
      const raw = await fs.readFile(path.join(repoRoot, flowFile), 'utf8');
      const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
      assert.ok(Array.isArray(parsed.steps), `${flowFile} should define steps`);

      const markers = flattenSteps(parsed.steps ?? []).map((step) => {
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

  test('implement_next_plan runs Codex review merge before classifier disposition and scope filtering', async () => {
    const raw = await fs.readFile(
      path.join(repoRoot, 'flows/implement_next_plan.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    assert.ok(
      Array.isArray(parsed.steps),
      'flows/implement_next_plan.json should define steps',
    );

    const markers = flattenSteps(parsed.steps ?? []).map((step) => {
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

    const codexReviewIndex = markers.indexOf(
      'review_artifacts_main,codex_review',
    );
    const mergeIndex = markers.indexOf(
      'merge_codex_review_findings_into_canonical_review.md',
    );
    const classifyIndex = markers.indexOf('classify_review_disposition.md');
    const filterIndex = markers.indexOf(
      'filter_review_findings_to_story_scope.md',
    );

    assert.notEqual(
      codexReviewIndex,
      -1,
      'flows/implement_next_plan.json should include the parallel review artifact subflow step',
    );
    assert.notEqual(
      mergeIndex,
      -1,
      'flows/implement_next_plan.json should merge Codex review findings',
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
    assert.ok(
      codexReviewIndex < mergeIndex &&
        mergeIndex < classifyIndex &&
        classifyIndex < filterIndex,
      'flows/implement_next_plan.json should run the parallel review artifact subflow, then merge it, then classify, then scope-filter findings',
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

  test('external review flow preserves adjudication trail after clean closeout', async () => {
    const raw = await fs.readFile(
      path.join(repoRoot, 'flows/ingest_external_review_plan.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { steps?: FlowStep[] };
    assert.ok(
      Array.isArray(parsed.steps),
      'flows/ingest_external_review_plan.json should define steps',
    );

    const markers = flattenSteps(parsed.steps ?? []).map((step) =>
      step.type === 'llm' ? step.markdownFile : undefined,
    );

    const closeoutIndex = markers.indexOf(
      'write_review_no_findings_closeout.md',
    );
    const adjudicationIndex = markers.indexOf(
      'preserve_external_review_adjudication_trail.md',
    );

    assert.notEqual(
      closeoutIndex,
      -1,
      'flows/ingest_external_review_plan.json should include clean review closeout',
    );
    assert.notEqual(
      adjudicationIndex,
      -1,
      'flows/ingest_external_review_plan.json should preserve the external adjudication trail',
    );
    assert.ok(
      closeoutIndex < adjudicationIndex,
      'flows/ingest_external_review_plan.json should preserve the external adjudication trail after clean closeout',
    );
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
