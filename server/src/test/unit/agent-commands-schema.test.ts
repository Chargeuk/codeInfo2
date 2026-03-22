import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseAgentCommandFile } from '../../agents/commandsSchema.js';
import { query, resetStore } from '../../logStore.js';

describe('agent command schema (v1)', () => {
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

  test('reingest items parse with target current', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', target: 'current' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.command.items[0], {
      type: 'reingest',
      target: 'current',
    });
  });

  test('reingest items parse with target all', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', target: 'all' }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.command.items[0], {
      type: 'reingest',
      target: 'all',
    });
  });

  test('reingest items reject sourceId and target together', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'reingest', sourceId: '/tmp/repo', target: 'current' }],
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
});
