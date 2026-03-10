import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseAgentCommandFile } from '../../agents/commandsSchema.js';

describe('agent command schema (v1)', () => {
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
