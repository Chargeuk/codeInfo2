import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeFlowDecisionScript,
  resolveFlowDecisionScriptPath,
  runFlowDecisionScript,
} from '../../flows/flowDecisionScript.js';

const initializeRepository = (repositoryRoot: string, scriptPath: string) => {
  execFileSync('git', ['init'], { cwd: repositoryRoot });
  execFileSync('git', ['add', path.relative(repositoryRoot, scriptPath)], {
    cwd: repositoryRoot,
  });
};

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
  const calls: Array<{
    file: string;
    args: string[];
    cwd: string;
    timeout: number;
    killSignal: 'SIGKILL';
  }> = [];
  try {
    const stdout = await runFlowDecisionScript({
      codeInfoRoot,
      workingFolder: '/repo',
      decisionScript: 'scripts/flow_control/check_complete.py',
      timeoutMs: 1_000,
      execFile: async (file, args, options) => {
        calls.push({
          file,
          args,
          cwd: options.cwd,
          timeout: options.timeout ?? -1,
          killSignal: options.killSignal ?? 'SIGKILL',
        });
        return { stdout: '{"answer":"yes"}\n', stderr: '' };
      },
    });

    assert.equal(stdout, '{"answer":"yes"}');
    assert.deepEqual(calls, [
      {
        file: 'python3',
        args: [scriptPath],
        cwd: '/repo',
        timeout: 1_000,
        killSignal: 'SIGKILL',
      },
    ]);
  } finally {
    fs.rmSync(codeInfoRoot, { recursive: true, force: true });
  }
});

test('checked-in repository entrypoint contract', async () => {
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
    const scriptPath = path.join(flowControlRoot, 'check_working_folder.py');
    fs.writeFileSync(
      scriptPath,
      'import os\nprint(os.getcwd())\n',
    );
    initializeRepository(scriptRepositoryRoot, scriptPath);
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

    const untrackedScriptPath = path.join(
      flowControlRoot,
      'check_untracked.py',
    );
    fs.writeFileSync(untrackedScriptPath, 'print("yes")\n');
    const untrackedResult = await executeFlowDecisionScript({
      workingFolder,
      scriptRepositoryRoot,
      decisionScript: 'scripts/flow_control/check_untracked.py',
      timeoutMs: 5_000,
    });
    assert.deepEqual(untrackedResult, {
      ok: false,
      reason:
        'Script file must be checked in: scripts/flow_control/check_untracked.py',
    });

    const symlinkPath = path.join(flowControlRoot, 'check_symlink.py');
    fs.symlinkSync('check_untracked.py', symlinkPath);
    const symlinkResult = await executeFlowDecisionScript({
      workingFolder,
      scriptRepositoryRoot,
      decisionScript: 'scripts/flow_control/check_symlink.py',
      timeoutMs: 5_000,
    });
    assert.deepEqual(symlinkResult, {
      ok: false,
      reason:
        'Script file must be checked in: scripts/flow_control/check_symlink.py',
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
    const scriptPath = path.join(flowControlRoot, 'retain-stdio.py');
    fs.writeFileSync(
      scriptPath,
      [
        'import subprocess',
        'import sys',
        'import time',
        'subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.5)"])',
        'time.sleep(5)',
        '',
      ].join('\n'),
    );
    initializeRepository(scriptRepositoryRoot, scriptPath);
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
