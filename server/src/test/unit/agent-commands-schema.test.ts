import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseAgentCommandFile } from '../../agents/commandsSchema.js';
import { query, resetStore } from '../../logStore.js';

describe('agent command schema (v1)', () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );

  test('does not emit Story 45 parse logs unless explicitly requested', () => {
    resetStore();
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: ['x'] }],
    });

    const parsed = parseAgentCommandFile(json, { commandName: 'sample' });
    assert.equal(parsed.ok, true);
    assert.equal(
      query({ text: 'DEV-0000045:T1:command_schema_item_parsed' }).length,
      0,
    );
  });

  test('emits Story 45 parse logs when explicitly requested', () => {
    resetStore();
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', sourceId: '/tmp/repo' }],
    });

    const parsed = parseAgentCommandFile(json, {
      commandName: 'sample',
      emitSchemaParseLogs: true,
    });
    assert.equal(parsed.ok, true);

    const logs = query({ text: 'DEV-0000045:T1:command_schema_item_parsed' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.context?.commandName, 'sample');
    assert.equal(logs[0]?.context?.itemIndex, 0);
  });

  test('valid command JSON parses as ok: true', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: ['x'] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
  });

  test('invalid JSON returns ok: false', () => {
    const parsed = parseAgentCommandFile('{ not valid json');
    assert.equal(parsed.ok, false);
  });

  test('missing Description returns ok: false', () => {
    const json = JSON.stringify({
      items: [{ type: 'message', role: 'user', content: ['x'] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('empty Description returns ok: false', () => {
    const json = JSON.stringify({
      Description: '',
      items: [{ type: 'message', role: 'user', content: ['x'] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('missing items returns ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('empty items array returns ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('unsupported item type returns ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'tool', role: 'user', content: ['x'] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('unsupported role returns ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'assistant', content: ['x'] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('content must be an array', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: 'not-an-array' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('empty content array returns ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: [] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('message items still parse when they use content', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: ['x', 'y'] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.command.items[0], {
      type: 'message',
      role: 'user',
      content: ['x', 'y'],
    });
  });

  test('message items parse when they use markdownFile', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [
        {
          type: 'message',
          role: 'user',
          markdownFile: 'architecture/review.md',
        },
      ],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.command.items[0], {
      type: 'message',
      role: 'user',
      markdownFile: 'architecture/review.md',
    });
  });

  test('reingest items parse with sourceId', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', sourceId: '/tmp/repo' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.command.items[0], {
      type: 'reingest',
      sourceId: '/tmp/repo',
    });
  });

  test('reingest items parse with target working', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', target: 'working' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.command.items[0], {
      type: 'reingest',
      target: 'working',
    });
  });

  test('reingest items parse with target plan_scope', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', target: 'plan_scope' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.command.items[0], {
      type: 'reingest',
      target: 'plan_scope',
    });
  });

  test('reingest items reject sourceId and target together', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', sourceId: '/tmp/repo', target: 'working' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest items reject removed target current', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', target: 'current' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest items reject removed target all', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', target: 'all' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest items reject unsupported target values', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', target: 'latest' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('reingest items reject whitespace-only sourceId values', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', sourceId: '   ' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('empty markdownFile returns ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', markdownFile: '' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('content and markdownFile together return ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [
        {
          type: 'message',
          role: 'user',
          content: ['x'],
          markdownFile: 'architecture/review.md',
        },
      ],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('message items with neither content nor markdownFile return ok: false', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('whitespace-only content entries are rejected after trimming', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: ['   '] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('unknown keys are rejected (strict), including reingest extras', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', sourceId: '/tmp/repo', extra: true }],
      extra: true,
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('trimming produces a clean command object', () => {
    const json = JSON.stringify({
      Description: '  A command  ',
      items: [
        { type: 'message', role: 'user', content: ['  first  ', ' second '] },
      ],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.command.Description, 'A command');
    const firstItem = parsed.command.items[0];
    assert.equal(firstItem.type, 'message');
    assert.equal('content' in firstItem, true);
    if (!('content' in firstItem)) return;
    assert.deepEqual(firstItem.content, ['first', 'second']);
  });

  test('emits Task 1 proof logs for accepted and rejected reingest targets', () => {
    resetStore();

    const accepted = parseAgentCommandFile(
      JSON.stringify({
        Description: 'A command',
        items: [{ type: 'reingest', target: 'working' }],
      }),
      {
        commandName: 'accepted-target',
        emitSchemaParseLogs: true,
      },
    );
    assert.equal(accepted.ok, true);

    const rejected = parseAgentCommandFile(
      JSON.stringify({
        Description: 'A command',
        items: [{ type: 'reingest', target: 'current' }],
      }),
      {
        commandName: 'rejected-target',
        emitSchemaParseLogs: true,
      },
    );
    assert.equal(rejected.ok, false);

    const logs = query({ text: 'DEV-0000052:T1:reingest-target-contract' });
    assert.equal(logs.length, 2);
    assert.equal(logs[0]?.context?.surface, 'command');
    assert.equal(logs[0]?.context?.definitionName, 'accepted-target');
    assert.equal(logs[0]?.context?.definitionIndex, 0);
    assert.equal(logs[0]?.context?.outcome, 'accepted_supported_target');
    assert.equal(logs[0]?.context?.supportedTarget, 'working');
    assert.equal(logs[1]?.context?.surface, 'command');
    assert.equal(logs[1]?.context?.definitionName, 'rejected-target');
    assert.equal(logs[1]?.context?.definitionIndex, 0);
    assert.equal(logs[1]?.context?.outcome, 'rejected_removed_target');
    assert.equal(logs[1]?.context?.removedTarget, 'current');
  });

  test('production review-agent commands remain valid JSON and schema', async () => {
    const commandFiles = [
      'codeinfo_agents/review_agent/commands/code_review_findings.json',
      'codeinfo_agents/review_agent/commands/external_review_blind_spot_challenge.json',
      'codeinfo_agents/review_agent/commands/external_review_evidence_gate.json',
      'codeinfo_agents/review_agent/commands/external_review_findings.json',
      'codeinfo_agents/review_agent/commands/external_review_findings_saturation.json',
      'codeinfo_agents/review_agent/commands/review_blind_spot_challenge.json',
      'codeinfo_agents/review_agent/commands/review_evidence_gate.json',
      'codeinfo_agents/review_agent/commands/review_findings_saturation.json',
      'codeinfo_agents/review_agent_lite/commands/code_review_findings.json',
      'codeinfo_agents/review_agent_lite/commands/external_review_blind_spot_challenge.json',
      'codeinfo_agents/review_agent_lite/commands/external_review_evidence_gate.json',
      'codeinfo_agents/review_agent_lite/commands/external_review_findings.json',
      'codeinfo_agents/review_agent_lite/commands/external_review_findings_saturation.json',
      'codeinfo_agents/review_agent_lite/commands/review_blind_spot_challenge.json',
      'codeinfo_agents/review_agent_lite/commands/review_evidence_gate.json',
      'codeinfo_agents/review_agent_lite/commands/review_findings_saturation.json',
    ] as const;

    for (const relativePath of commandFiles) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      assert.doesNotThrow(() => JSON.parse(raw), relativePath);

      const parsed = parseAgentCommandFile(raw, {
        commandName: path.parse(relativePath).name,
      });
      assert.equal(parsed.ok, true, relativePath);
    }
  });

  test('production planning-agent commands remain valid JSON and schema', async () => {
    const commandFiles = [
      'codeinfo_agents/planning_agent/commands/check_review_disposition_regression.json',
      'codeinfo_agents/planning_agent/commands/create_new_story.json',
      'codeinfo_agents/planning_agent/commands/enhance_review_tasks.json',
      'codeinfo_agents/planning_agent/commands/improve_plan.json',
      'codeinfo_agents/planning_agent/commands/improve_plan2.json',
      'codeinfo_agents/planning_agent/commands/qa.json',
      'codeinfo_agents/planning_agent/commands/task_up_review_tasks.json',
    ] as const;

    for (const relativePath of commandFiles) {
      const raw = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      assert.doesNotThrow(() => JSON.parse(raw), relativePath);

      const parsed = parseAgentCommandFile(raw, {
        commandName: path.parse(relativePath).name,
      });
      assert.equal(parsed.ok, true, relativePath);
    }
  });
});
