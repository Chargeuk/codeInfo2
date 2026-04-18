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

  test('invalid JSON returns ok: false', () => {
    const parsed = parseFlowFile('{ not valid json');
    assert.equal(parsed.ok, false);
  });

  test('production implementation-loop flows remain valid JSON and schema', async () => {
    const flowFiles = [
      'flows/implement_next_plan.json',
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
