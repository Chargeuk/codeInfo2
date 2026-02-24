import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SERVER_PORT,
  resolveServerPort,
} from '../../config/serverPort.js';

describe('resolveServerPort', () => {
  it('uses SERVER_PORT when it is provided', () => {
    const port = resolveServerPort({
      SERVER_PORT: '5510',
      PORT: '5010',
    } as NodeJS.ProcessEnv);
    assert.equal(port, '5510');
  });

  it('falls back to PORT when SERVER_PORT is not provided', () => {
    const port = resolveServerPort({
      PORT: '5010',
    } as NodeJS.ProcessEnv);
    assert.equal(port, '5010');
  });

  it('falls back to default when neither is set', () => {
    const port = resolveServerPort({} as NodeJS.ProcessEnv);
    assert.equal(port, DEFAULT_SERVER_PORT);
  });

  it('ignores blank values', () => {
    const port = resolveServerPort({
      SERVER_PORT: '   ',
      PORT: '  ',
    } as NodeJS.ProcessEnv);
    assert.equal(port, DEFAULT_SERVER_PORT);
  });
});
