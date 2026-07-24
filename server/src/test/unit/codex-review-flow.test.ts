import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseFlowFile } from '../../flows/flowSchema.js';

const repoRoot = path.resolve(process.cwd(), '..');
const launcherPath = path.join(repoRoot, 'scripts/run-codex-review.sh');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createFakeCodex(tempRoot: string): string {
  const fakeCodex = path.join(tempRoot, 'fake-codex.sh');
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\0' "$@" > "\${FAKE_CODEX_ARGS_FILE}"
if IFS= read -r unexpected_stdin; then
  printf '%s\\n' "\${unexpected_stdin}" > "\${FAKE_CODEX_STDIN_FILE}"
  exit 91
fi
printf 'eof\\n' > "\${FAKE_CODEX_STDIN_FILE}"
native_output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output-last-message' ]; then
    native_output="$2"
    shift 2
  else
    shift
  fi
done
printf 'native review response\\n' > "\${native_output}"
printf 'fake stdout\\n'
printf 'fake stderr\\n' >&2
exit "\${FAKE_CODEX_EXIT:-0}"
`,
    { mode: 0o755 },
  );
  return fakeCodex;
}

test('Codex review flow uses the generic workspace agent and launcher prompt', () => {
  const raw = readRepoFile('flows/codex_review.json');
  const parsed = parseFlowFile(raw, { flowName: 'codex_review' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.deepEqual(parsed.flow.steps, [
    {
      type: 'llm',
      label: 'Run Codex Workspace Review',
      agentType: 'review_agent_heavy',
      identifier: 'codex_workspace_reviewer',
      markdownFile: 'run_codex_review_workspace.md',
    },
  ]);

  const prompt = readRepoFile(
    'codeInfo_markdown/run_codex_review_workspace.md',
  );
  for (const required of [
    '$CODEINFO_ROOT/scripts/run-codex-review.sh',
    'do not construct or invoke `codex exec review` directly',
    'model `gpt-5.6-sol`',
    'reasoning effort `high`',
    '--dangerously-bypass-approvals-and-sandbox',
    "Redirect the launcher's stdout and stderr to separate files",
    'actual process exit status',
  ]) {
    assert.match(
      prompt,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
    );
  }
});

test('Codex review launcher fixes Docker-native invocation settings', (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codex-review-launcher-'),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const fakeCodex = createFakeCodex(tempRoot);
  const instructionsFile = path.join(tempRoot, 'instructions.md');
  const outputFile = path.join(tempRoot, 'native-response.md');
  const argsFile = path.join(tempRoot, 'args.bin');
  const stdinFile = path.join(tempRoot, 'stdin.txt');
  const instructions = 'Review the pinned diff.\nExclude planning/**.\n';
  fs.writeFileSync(instructionsFile, instructions);

  const result = spawnSync(
    launcherPath,
    [
      '--base',
      '0123456789abcdef',
      '--model',
      'gpt-5.6-sol',
      '--reasoning-effort',
      'high',
      '--instructions-file',
      instructionsFile,
      '--output-file',
      outputFile,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEINFO_CODEX_BIN: fakeCodex,
        FAKE_CODEX_ARGS_FILE: argsFile,
        FAKE_CODEX_STDIN_FILE: stdinFile,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'fake stdout\n');
  assert.equal(result.stderr, 'fake stderr\n');
  assert.equal(fs.readFileSync(stdinFile, 'utf8'), 'eof\n');
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'native review response\n');

  const args = fs.readFileSync(argsFile, 'utf8').split('\0').filter(Boolean);
  assert.deepEqual(args, [
    'exec',
    'review',
    '--dangerously-bypass-approvals-and-sandbox',
    '--ephemeral',
    '--model',
    'gpt-5.6-sol',
    '--base',
    '0123456789abcdef',
    '--config',
    'model_reasoning_effort="high"',
    '--config',
    `developer_instructions=${instructions.trimEnd()}`,
    '--output-last-message',
    outputFile,
  ]);
});

test('Codex review launcher preserves the native process exit status', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-exit-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const instructionsFile = path.join(tempRoot, 'instructions.md');
  fs.writeFileSync(instructionsFile, 'Review this diff.\n');
  const result = spawnSync(
    launcherPath,
    [
      '--base',
      'base-commit',
      '--model',
      'review-model',
      '--reasoning-effort',
      'medium',
      '--instructions-file',
      instructionsFile,
      '--output-file',
      path.join(tempRoot, 'native-response.md'),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEINFO_CODEX_BIN: createFakeCodex(tempRoot),
        FAKE_CODEX_ARGS_FILE: path.join(tempRoot, 'args.bin'),
        FAKE_CODEX_STDIN_FILE: path.join(tempRoot, 'stdin.txt'),
        FAKE_CODEX_EXIT: '17',
      },
    },
  );

  assert.equal(result.status, 17);
});

test('Codex review launcher rejects missing input before invoking Codex', (t) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codex-review-input-'),
  );
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const result = spawnSync(
    launcherPath,
    [
      '--base',
      'base-commit',
      '--model',
      'review-model',
      '--reasoning-effort',
      'high',
      '--instructions-file',
      path.join(tempRoot, 'missing.md'),
      '--output-file',
      path.join(tempRoot, 'native-response.md'),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEINFO_CODEX_BIN: createFakeCodex(tempRoot),
        FAKE_CODEX_ARGS_FILE: path.join(tempRoot, 'args.bin'),
        FAKE_CODEX_STDIN_FILE: path.join(tempRoot, 'stdin.txt'),
      },
    },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /instructions file does not exist/u);
  assert.equal(fs.existsSync(path.join(tempRoot, 'args.bin')), false);
});
