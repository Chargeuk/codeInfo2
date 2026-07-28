import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeFlowDecisionScript,
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

test('bundled flow decision scripts execute without Git metadata and return trimmed stdout', async () => {
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

test('decision scripts execute without Git metadata in the worked repository', async () => {
  const scriptRepositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'flow-script-repository-'),
  );
  const workingFolder = fs.mkdtempSync(
    path.join(os.tmpdir(), 'flow-working-repository-'),
  );
  try {
    const flowControlRoot = path.join(
      scriptRepositoryRoot,
      'scripts',
      'flow_control',
    );
    fs.mkdirSync(flowControlRoot, { recursive: true });
    fs.writeFileSync(
      path.join(flowControlRoot, 'check_working_folder.py'),
      'import os\nprint(os.getcwd())\n',
    );
    const result = await executeFlowDecisionScript({
      workingFolder,
      scriptRepositoryRoot,
      decisionScript: 'scripts/flow_control/check_working_folder.py',
      timeoutMs: 5_000,
    });

    assert.deepEqual(result, {
      ok: true,
      stdout: fs.realpathSync(workingFolder),
    });
  } finally {
    fs.rmSync(scriptRepositoryRoot, { recursive: true, force: true });
    fs.rmSync(workingFolder, { recursive: true, force: true });
  }
});

test('timed-out decision scripts settle even when a descendant retains stdout', async () => {
  const scriptRepositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'flow-script-repository-'),
  );
  const workingFolder = fs.mkdtempSync(
    path.join(os.tmpdir(), 'flow-working-repository-'),
  );
  try {
    const flowControlRoot = path.join(
      scriptRepositoryRoot,
      'scripts',
      'flow_control',
    );
    fs.mkdirSync(flowControlRoot, { recursive: true });
    fs.writeFileSync(
      path.join(flowControlRoot, 'retain-stdio.py'),
      [
        'import subprocess',
        'import sys',
        'import time',
        'subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.5)"])',
        'time.sleep(5)',
        '',
      ].join('\n'),
    );
    const startedAt = Date.now();
    const result = await executeFlowDecisionScript({
      workingFolder,
      scriptRepositoryRoot,
      decisionScript: 'scripts/flow_control/retain-stdio.py',
      timeoutMs: 25,
    });

    assert.deepEqual(result, {
      ok: false,
      reason:
        'Script timed out after 25ms: scripts/flow_control/retain-stdio.py',
    });
    assert.ok(Date.now() - startedAt < 250);
  } finally {
    fs.rmSync(scriptRepositoryRoot, { recursive: true, force: true });
    fs.rmSync(workingFolder, { recursive: true, force: true });
  }
});
