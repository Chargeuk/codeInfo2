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

  test('whitespace-only content entries are rejected after trimming', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: ['   '] }],
    });

    const parsed = parseAgentCommandFile(json);
    assert.equal(parsed.ok, false);
  });

  test('unknown keys are rejected (strict)', () => {
    const json = JSON.stringify({
      Description: 'A command',
      items: [{ type: 'message', role: 'user', content: ['x'] }],
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
    assert.deepEqual(parsed.command.items[0].content, ['first', 'second']);
  });
});
