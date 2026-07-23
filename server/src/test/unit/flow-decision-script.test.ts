import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveFlowDecisionScriptPath,
  runFlowDecisionScript,
} from '../../flows/flowDecisionScript.js';

test('flow decision scripts are restricted to the flow_control helper directory', () => {
  assert.equal(
    resolveFlowDecisionScriptPath(
      '/codeinfo',
      'scripts/flow_control/check_complete.py',
    ),
    '/codeinfo/scripts/flow_control/check_complete.py',
  );
  assert.throws(
    () => resolveFlowDecisionScriptPath('/codeinfo', '../outside.py'),
    /scripts\/flow_control/,
  );
  assert.throws(
    () =>
      resolveFlowDecisionScriptPath(
        '/codeinfo',
        'scripts/flow_control/check_complete.sh',
      ),
    /Python files/,
  );
});

test('flow decision scripts execute with the repository working folder and return trimmed stdout', async () => {
  const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
  const stdout = await runFlowDecisionScript({
    codeInfoRoot: '/codeinfo',
    workingFolder: '/repo',
    decisionScript: 'scripts/flow_control/check_complete.py',
    execFile: async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      return { stdout: '{"answer":"yes"}\n', stderr: '' };
    },
  });

  assert.equal(stdout, '{"answer":"yes"}');
  assert.deepEqual(calls, [
    {
      file: 'python3',
      args: ['/codeinfo/scripts/flow_control/check_complete.py'],
      cwd: '/repo',
    },
  ]);
});
