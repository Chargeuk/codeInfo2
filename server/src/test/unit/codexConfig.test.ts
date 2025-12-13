import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildCodexOptions } from '../../config/codexConfig.js';

describe('codexConfig', () => {
  it('buildCodexOptions sets CODEX_HOME to the resolved override path', () => {
    const options = buildCodexOptions({ codexHome: '/tmp/x' });
    assert(options);
    assert.equal(options.env?.CODEX_HOME, path.resolve('/tmp/x'));
  });
});
