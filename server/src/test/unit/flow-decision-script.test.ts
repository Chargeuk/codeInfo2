import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  resolveFlowDecisionScriptPath,
  runFlowDecisionScript,
} from '../../flows/flowDecisionScript.js';

test('flow decision scripts are restricted to the flow_control helper directory', () => {
  const codeInfoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-control-'));
  try {
    const flowControlRoot = path.join(codeInfoRoot, 'scripts', 'flow_control');
    fs.mkdirSync(flowControlRoot, { recursive: true });
    const allowedScript = path.join(flowControlRoot, 'check_complete.py');
    fs.writeFileSync(allowedScript, '#!/usr/bin/env python3\n');
    const outsideScript = path.join(codeInfoRoot, 'outside.py');
    fs.writeFileSync(outsideScript, '#!/usr/bin/env python3\n');

    assert.equal(
      resolveFlowDecisionScriptPath(
        codeInfoRoot,
        'scripts/flow_control/check_complete.py',
      ),
      allowedScript,
    );
    assert.throws(
      () => resolveFlowDecisionScriptPath(codeInfoRoot, '../outside.py'),
      /scripts\/flow_control/,
    );
    assert.throws(
      () =>
        resolveFlowDecisionScriptPath(
          codeInfoRoot,
          'scripts/flow_control/check_complete.sh',
        ),
      /Python files/,
    );
    fs.symlinkSync(outsideScript, path.join(flowControlRoot, 'escaped.py'));
    assert.throws(
      () =>
        resolveFlowDecisionScriptPath(
          codeInfoRoot,
          'scripts/flow_control/escaped.py',
        ),
      /scripts\/flow_control/,
    );
  } finally {
    fs.rmSync(codeInfoRoot, { recursive: true, force: true });
  }
});

test('flow decision scripts execute with the repository working folder and return trimmed stdout', async () => {
  const codeInfoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-control-'));
  const flowControlRoot = path.join(codeInfoRoot, 'scripts', 'flow_control');
  fs.mkdirSync(flowControlRoot, { recursive: true });
  const scriptPath = path.join(flowControlRoot, 'check_complete.py');
  fs.writeFileSync(scriptPath, '#!/usr/bin/env python3\n');
  const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
  try {
    const stdout = await runFlowDecisionScript({
      codeInfoRoot,
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
        args: [scriptPath],
        cwd: '/repo',
      },
    ]);
  } finally {
    fs.rmSync(codeInfoRoot, { recursive: true, force: true });
  }
});
