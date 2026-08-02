import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COPILOT_REVIEW_EXCLUDED_PATHS,
  resolveCopilotReviewTimeoutMs,
  resolveCopilotReviewWorkspacePaths,
  runCopilotReview,
  type CopilotReviewLauncherOptions,
} from '../../copilot/reviewLauncher.js';

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

const makeFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-review-'));
  const repo = path.join(root, 'repo');
  const workspace = path.join(root, 'workspace');
  await Promise.all([
    fs.mkdir(repo, { recursive: true }),
    fs.mkdir(path.join(workspace, 'input'), { recursive: true }),
    fs.mkdir(path.join(workspace, 'work'), { recursive: true }),
    fs.mkdir(path.join(workspace, 'output'), { recursive: true }),
  ]);
  git(repo, 'init');
  git(repo, 'config', 'user.email', 'test@example.test');
  git(repo, 'config', 'user.name', 'Test User');
  await fs.writeFile(path.join(repo, 'file.txt'), 'base\n', 'utf8');
  git(repo, 'add', 'file.txt');
  git(repo, 'commit', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(repo, 'file.txt'), 'base\nhead\n', 'utf8');
  git(repo, 'add', 'file.txt');
  git(repo, 'commit', '-m', 'head');
  const head = git(repo, 'rev-parse', 'HEAD');

  const outputPaths = await resolveCopilotReviewWorkspacePaths(workspace);
  await fs.writeFile(
    outputPaths.availabilitySpecPath,
    `${JSON.stringify(
      {
        mode: 'native',
        modelId: 'gpt-5.4',
        reasoningEffort: 'low',
        available: true,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const instructions = outputPaths.instructionsPath;
  await fs.writeFile(instructions, 'Review the pinned diff. Do not edit.\n');
  return {
    root,
    repo,
    workspace,
    instructions,
    outputPaths,
    base,
    head,
  };
};

const makeFakeCopilot = async (root: string) => {
  const executable = path.join(root, 'fake-copilot.sh');
  await fs.writeFile(
    executable,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'launch\\n' >> "$FAKE_COPILOT_COUNT_FILE"
printf '%s\\0' "$@" > "$FAKE_COPILOT_ARGS_FILE"
env | sort > "$FAKE_COPILOT_ENV_FILE"
if IFS= read -r unexpected; then
  printf 'data:%s\\n' "$unexpected" > "$FAKE_COPILOT_STDIN_FILE"
else
  printf 'eof\\n' > "$FAKE_COPILOT_STDIN_FILE"
fi
printf '%b' "\${FAKE_COPILOT_STDOUT:-}"
printf '%b' "\${FAKE_COPILOT_STDERR:-}" >&2
if [[ "\${FAKE_COPILOT_WAIT:-}" == "1" ]]; then
  trap 'exit 143' TERM
  while true; do
    sleep 0.05
  done
fi
exit "\${FAKE_COPILOT_EXIT:-0}"
`,
    { mode: 0o755 },
  );
  return executable;
};

const launcherOptions = (
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  env: NodeJS.ProcessEnv,
  overrides: Partial<CopilotReviewLauncherOptions> = {},
): CopilotReviewLauncherOptions => ({
  repositoryPath: fixture.repo,
  workspacePath: fixture.workspace,
  targetId: 'repository-a',
  reviewWaveId: 'review-wave-1',
  jobInstanceId: 'copilot-model:repository-a:copilot_review',
  baseCommit: fixture.base,
  headCommit: fixture.head,
  modelId: 'gpt-5.4',
  reasoningEffort: 'low',
  env,
  ...overrides,
});

const artifactPaths = (
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): string[] => [
  fixture.outputPaths.stdoutPath,
  fixture.outputPaths.stderrPath,
  fixture.outputPaths.exitStatusPath,
  fixture.outputPaths.invocationPath,
  fixture.outputPaths.normalizedResultPath,
  fixture.outputPaths.usagePath,
];

const fakeEnvironment = (
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  fakeCopilot: string,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  ...process.env,
  CODEINFO_COPILOT_CLI_PATH: fakeCopilot,
  FAKE_COPILOT_ARGS_FILE: path.join(fixture.root, 'args.bin'),
  FAKE_COPILOT_ENV_FILE: path.join(fixture.root, 'env.txt'),
  FAKE_COPILOT_STDIN_FILE: path.join(fixture.root, 'stdin.txt'),
  FAKE_COPILOT_COUNT_FILE: path.join(fixture.root, 'count.txt'),
  FAKE_COPILOT_STDOUT:
    '{"type":"unknown.future","data":{"ignored":true}}\\n{"type":"assistant.message","data":{"content":"Review result"}}\\n{"type":"turn.completed","usage":{"input_tokens":11,"cached_input_tokens":3,"output_tokens":7,"reasoning_output_tokens":2}}\\n{"type":"result","usage":{"premiumRequests":0.33,"totalApiDurationMs":1200,"sessionDurationMs":1500,"codeChanges":{"linesAdded":0,"linesRemoved":0,"filesModified":[]}}}\\n',
  FAKE_COPILOT_STDERR: 'diagnostic\\n',
  ...overrides,
});

const nulArgs = async (filePath: string): Promise<string[]> =>
  (await fs.readFile(filePath)).toString('utf8').split('\0').filter(Boolean);

const assertFullAccessArguments = (args: string[]) => {
  assert.equal(args.filter((argument) => argument === '--allow-all').length, 1);
  for (const removedRestriction of [
    '--available-tools=view,grep,glob,bash',
    '--allow-tool=read',
    '--deny-tool=write',
  ]) {
    assert.equal(args.includes(removedRestriction), false, removedRestriction);
  }
  assert.equal(
    args.some(
      (argument) =>
        argument.startsWith('--allow-tool=') ||
        argument.startsWith('--deny-tool=') ||
        argument.startsWith('--available-tools='),
    ),
    false,
    'full-access review must not retain conflicting tool restrictions',
  );
};

test('workspace paths are derived from one real assigned job directory', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  assert.equal(
    fixture.outputPaths.instructionsPath,
    path.join(fixture.workspace, 'work', 'copilot-review-instructions.md'),
  );
  assert.equal(
    fixture.outputPaths.stdoutPath,
    path.join(fixture.workspace, 'work', 'copilot.stdout.jsonl'),
  );
  assert.equal(
    fixture.outputPaths.normalizedResultPath,
    path.join(fixture.workspace, 'output', 'copilot-review.json'),
  );
  assert.equal(
    fixture.outputPaths.availabilitySpecPath,
    path.join(fixture.workspace, 'input', 'copilot-review-spec.json'),
  );
});

test('workspace path derivation rejects an assigned directory that resolves outside the job', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-review-paths-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  await Promise.all([
    fs.mkdir(path.join(workspace, 'input'), { recursive: true }),
    fs.mkdir(path.join(workspace, 'output'), { recursive: true }),
    fs.mkdir(outside, { recursive: true }),
  ]);
  await fs.symlink(outside, path.join(workspace, 'work'));

  await assert.rejects(
    resolveCopilotReviewWorkspacePaths(workspace),
    /must remain inside the assigned workspace/u,
  );
});

test('native launcher invokes local /review once with pinned full-access non-interactive arguments and closed stdin', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const secret = 'sk-native-inherited-secret';
  const env = fakeEnvironment(fixture, fakeCopilot, {
    CODEINFO_COPILOT_HOME: path.join(fixture.root, 'copilot-home'),
    COPILOT_PROVIDER_TYPE: 'openai',
    COPILOT_PROVIDER_BASE_URL: 'https://wrong.test/v1',
    COPILOT_PROVIDER_API_KEY: secret,
    COPILOT_MODEL: 'wrong',
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: `Wrong,${secret}`,
    CODEINFO_OPENAI_EMBEDDING_KEY: 'sk-embedding-provider-secret',
  });

  const result = await runCopilotReview(launcherOptions(fixture, env));
  assert.equal(result.status, 'successful');
  assert.equal(result.exitStatus, 0);
  assert.equal(result.launched, true);

  const args = await nulArgs(String(env.FAKE_COPILOT_ARGS_FILE));
  const prompt = args[args.indexOf('--prompt') + 1] ?? '';
  assert.match(prompt, /^\/review /u);
  assert.match(
    prompt,
    new RegExp(`${fixture.base}\\.\\.\\.${fixture.head}`, 'u'),
  );
  assert.match(
    prompt,
    new RegExp(fixture.instructions.replaceAll('/', '\\/'), 'u'),
  );
  assert.match(
    prompt,
    /Exclude all changed files under planning\/\*\* from the review/u,
  );
  assert.equal(
    prompt.includes(
      `git diff ${fixture.base}...${fixture.head} -- . ':(exclude)planning/**'`,
    ),
    true,
  );
  for (const expected of [
    '--model',
    'gpt-5.4',
    '--reasoning-effort',
    'low',
    '--output-format',
    'json',
    '--no-ask-user',
    '--no-auto-update',
    '--no-remote',
    '--no-remote-export',
    '--no-custom-instructions',
    '--disable-builtin-mcps',
    '--allow-all',
  ]) {
    assert.equal(args.includes(expected), true, expected);
  }
  assertFullAccessArguments(args);
  assert.equal(
    args.some((arg) => arg.startsWith('--secret-env-vars=')),
    true,
  );
  assert.equal(
    await fs.readFile(String(env.FAKE_COPILOT_STDIN_FILE), 'utf8'),
    'eof\n',
  );
  assert.equal(
    (await fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8')).trim(),
    'launch',
  );

  const childEnv = await fs.readFile(String(env.FAKE_COPILOT_ENV_FILE), 'utf8');
  assert.doesNotMatch(childEnv, /COPILOT_PROVIDER_/u);
  assert.doesNotMatch(
    childEnv,
    /CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS/u,
  );
  assert.doesNotMatch(childEnv, /CODEINFO_OPENAI_EMBEDDING_KEY/u);
  assert.match(
    childEnv,
    new RegExp(`COPILOT_HOME=${path.join(fixture.root, 'copilot-home')}`, 'u'),
  );
  assert.match(childEnv, /^GIT_OPTIONAL_LOCKS=0$/mu);
  assert.match(childEnv, /^GIT_TERMINAL_PROMPT=0$/mu);
  assert.match(childEnv, /^GIT_PAGER=cat$/mu);
  assert.match(childEnv, /^PAGER=cat$/mu);
  const artifacts = await Promise.all(
    artifactPaths(fixture).map((file) => fs.readFile(file, 'utf8')),
  );
  assert.doesNotMatch(artifacts.join('\n'), new RegExp(secret, 'u'));
  assert.doesNotMatch(artifacts.join('\n'), /sk-embedding-provider-secret/u);
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as {
    review?: string;
    excluded_paths?: string[];
    usage?: {
      input_tokens?: number;
      premium_requests?: number;
      total_api_duration_ms?: number;
      session_duration_ms?: number;
      code_changes?: {
        lines_added?: number;
        lines_removed?: number;
        files_modified?: string[];
      };
    };
  };
  assert.equal(normalized.review, 'Review result');
  assert.deepEqual(normalized.excluded_paths, [
    ...COPILOT_REVIEW_EXCLUDED_PATHS,
  ]);
  assert.equal(normalized.usage?.input_tokens, 11);
  assert.equal(normalized.usage?.premium_requests, 0.33);
  assert.equal(normalized.usage?.total_api_duration_ms, 1200);
  assert.equal(normalized.usage?.session_duration_ms, 1500);
  assert.deepEqual(normalized.usage?.code_changes, {
    lines_added: 0,
    lines_removed: 0,
    files_modified: [],
  });
});

test('external launcher exposes only the selected endpoint and key to the child', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const selectedSecret = 'key';
  const otherSecret = 'sk-other-secret';
  const env = fakeEnvironment(fixture, fakeCopilot, {
    COPILOT_HOME: path.join(fixture.root, 'ambient-copilot-home'),
    CODEINFO_COPILOT_HOME: path.join(fixture.root, 'native-copilot-home'),
    COPILOT_GITHUB_TOKEN: 'copilot-native-token',
    GH_TOKEN: 'gh-native-token',
    GITHUB_TOKEN: 'github-native-token',
    CODEINFO_CONTEXT7_API_KEY: 'context7-secret',
    NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/custom-corporate-ca.pem',
    CODEINFO_UNRELATED_AMBIENT_VALUE: 'must-not-cross-provider-boundary',
    SECRET_UNRELATED_AMBIENT_VALUE: 'ambient-secret',
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
      'Other,https://other.test/v1|completions;Unsloth,https://selected.test/v1|completions',
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: `Unsloth,${selectedSecret};Other,${otherSecret}`,
    FAKE_COPILOT_STDERR: `provider diagnostic ${selectedSecret}\n`,
  });
  const result = await runCopilotReview(
    launcherOptions(fixture, env, {
      endpointLabel: 'unsloth',
      endpointId: 'https://selected.test/v1',
      modelId: 'google-gemini-3.6-flash',
      reasoningEffort: 'minimal',
    }),
    {
      discoverExternalModels: async () => ['google-gemini-3.6-flash'],
    },
  );
  assert.equal(result.status, 'successful');
  assertFullAccessArguments(await nulArgs(String(env.FAKE_COPILOT_ARGS_FILE)));
  const childEnv = await fs.readFile(String(env.FAKE_COPILOT_ENV_FILE), 'utf8');
  assert.match(childEnv, /COPILOT_PROVIDER_TYPE=openai/u);
  assert.match(
    childEnv,
    /COPILOT_PROVIDER_BASE_URL=https:\/\/selected\.test\/v1/u,
  );
  assert.match(childEnv, /COPILOT_PROVIDER_WIRE_API=completions/u);
  assert.match(childEnv, /COPILOT_MODEL=google-gemini-3\.6-flash/u);
  assert.doesNotMatch(childEnv, /^COPILOT_HOME=/mu);
  assert.doesNotMatch(
    childEnv,
    new RegExp(`${fixture.root}/(ambient|native)-copilot-home`, 'u'),
  );
  assert.doesNotMatch(
    childEnv,
    /^(?:COPILOT_GITHUB_TOKEN|GH_TOKEN|GITHUB_TOKEN)=/mu,
  );
  assert.doesNotMatch(childEnv, /^CODEINFO_CONTEXT7_API_KEY=/mu);
  assert.match(
    childEnv,
    /^NODE_EXTRA_CA_CERTS=\/etc\/ssl\/certs\/custom-corporate-ca\.pem$/mu,
  );
  assert.doesNotMatch(childEnv, /^CODEINFO_UNRELATED_AMBIENT_VALUE=/mu);
  assert.doesNotMatch(childEnv, /^SECRET_UNRELATED_AMBIENT_VALUE=/mu);
  assert.match(
    childEnv,
    new RegExp(`COPILOT_PROVIDER_API_KEY=${selectedSecret}`, 'u'),
  );
  assert.doesNotMatch(childEnv, new RegExp(otherSecret, 'u'));
  assert.doesNotMatch(childEnv, /CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS/u);
  assert.doesNotMatch(
    childEnv,
    /CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS/u,
  );
  assert.doesNotMatch(childEnv, /https:\/\/other\.test/u);
  const persisted = (
    await Promise.all(
      artifactPaths(fixture).map((file) => fs.readFile(file, 'utf8')),
    )
  ).join('\n');
  assert.doesNotMatch(
    persisted,
    new RegExp(`${selectedSecret}|${otherSecret}`, 'u'),
  );
  assert.doesNotMatch(persisted, /https:\/\/other\.test/u);
  assert.match(persisted, /provider diagnostic \[REDACTED\]/u);
  const invocation = JSON.parse(
    await fs.readFile(fixture.outputPaths.invocationPath, 'utf8'),
  ) as { endpoint_id?: string; excluded_paths?: string[] };
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as { endpoint_id?: string };
  assert.equal(invocation.endpoint_id, 'https://selected.test/v1');
  assert.deepEqual(invocation.excluded_paths, [
    ...COPILOT_REVIEW_EXCLUDED_PATHS,
  ]);
  assert.equal(normalized.endpoint_id, 'https://selected.test/v1');
});

test('external launcher normalizes intact JSONL before redacting a structural credential value', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot, {
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
      'Unsloth,https://selected.test/v1|completions',
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: 'Unsloth,data',
    FAKE_COPILOT_STDOUT:
      '{"type":"assistant.message","data":{"content":"Review data result"}}\\n{"type":"turn.completed","usage":{"input_tokens":11}}\\n',
  });

  const result = await runCopilotReview(
    launcherOptions(fixture, env, {
      endpointLabel: 'unsloth',
      endpointId: 'https://selected.test/v1',
      modelId: 'google-gemini-3.6-flash',
      reasoningEffort: 'minimal',
    }),
    {
      discoverExternalModels: async () => ['google-gemini-3.6-flash'],
    },
  );

  assert.equal(result.status, 'successful');
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as { review?: string; usage?: { input_tokens?: number } };
  assert.equal(normalized.review, 'Review [REDACTED] result');
  assert.equal(normalized.usage?.input_tokens, 11);
  const rawJsonl = await fs.readFile(fixture.outputPaths.stdoutPath, 'utf8');
  assert.doesNotMatch(rawJsonl, /"data"/u);
  assert.match(rawJsonl, /"\[REDACTED\]"/u);
});

test('non-zero Copilot exit preserves unknown JSONL, stderr, and a partial normalized result', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot, {
    FAKE_COPILOT_EXIT: '17',
    FAKE_COPILOT_STDOUT:
      '{"type":"unknown.future","payload":{"value":1}}\\n{"type":"assistant.message","data":{"content":"Partial review"}}\\n',
    FAKE_COPILOT_STDERR: 'provider failed\\n',
  });
  const result = await runCopilotReview(launcherOptions(fixture, env));
  assert.equal(result.exitStatus, 17);
  assert.equal(result.status, 'partial');
  assert.match(
    await fs.readFile(fixture.outputPaths.stdoutPath, 'utf8'),
    /unknown\.future/u,
  );
  assert.equal(
    await fs.readFile(fixture.outputPaths.stderrPath, 'utf8'),
    'provider failed\n',
  );
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as { failure_reason?: string };
  assert.equal(normalized.failure_reason, 'provider failed');
});

test('zero-exit non-assistant JSONL remains raw and produces a partial result', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot, {
    FAKE_COPILOT_STDOUT:
      '{"type":"user.message","data":{"content":"Review prompt"}}\\n{"type":"assistant.reasoning","data":{"content":"Reasoning"}}\\n{"type":"tool.execution_complete","data":{"result":"Tool output"}}\\n{"type":"unknown.future","data":{"output":"Unknown output"}}\\n{"type":"result","data":{"message":"Terminal message"}}\\n',
  });

  const result = await runCopilotReview(launcherOptions(fixture, env));

  assert.equal(result.exitStatus, 0);
  assert.equal(result.status, 'partial');
  assert.match(
    await fs.readFile(fixture.outputPaths.stdoutPath, 'utf8'),
    /user\.message/u,
  );
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as { review?: string | null; status?: string };
  assert.equal(normalized.review, null);
  assert.equal(normalized.status, 'partial');
});

test('missing CLI and external runtime drift produce unavailable artifacts without a second launch', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const env = fakeEnvironment(fixture, path.join(fixture.root, 'missing'));
  const missing = await runCopilotReview(launcherOptions(fixture, env));
  assert.equal(missing.launched, false);
  assert.equal(missing.exitStatus, 127);
  assert.equal(missing.status, 'unavailable');

  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const driftEnv = fakeEnvironment(fixture, fakeCopilot, {
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
      'Unsloth,https://selected.test/v1|completions',
  });
  const drift = await runCopilotReview(
    launcherOptions(fixture, driftEnv, {
      endpointLabel: 'unsloth',
      endpointId: 'https://selected.test/v1',
      modelId: 'gone',
    }),
    { discoverExternalModels: async () => ['other'] },
  );
  assert.equal(drift.launched, false);
  assert.equal(drift.status, 'unavailable');
  await assert.rejects(
    fs.readFile(String(driftEnv.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
});

test('policy preflight failure writes unavailable artifacts without launching Copilot', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot);
  await fs.rm(fixture.instructions);

  const result = await runCopilotReview(
    launcherOptions(fixture, env, {
      preflightUnavailableReason:
        'Copilot review instructions policy.md are unavailable.',
    }),
  );

  assert.equal(result.launched, false);
  assert.equal(result.status, 'unavailable');
  await assert.rejects(
    fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as { failure_reason?: string; launched?: boolean; status?: string };
  assert.equal(normalized.launched, false);
  assert.equal(normalized.status, 'unavailable');
  assert.equal(
    normalized.failure_reason,
    'Copilot review instructions policy.md are unavailable.',
  );
});

test('pinned unavailable model produces canonical artifacts without requiring instructions or launching Copilot', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot);
  await Promise.all([
    fs.rm(fixture.instructions),
    fs.writeFile(
      fixture.outputPaths.availabilitySpecPath,
      `${JSON.stringify(
        {
          mode: 'external',
          modelId: 'unavailable-model',
          reasoningEffort: 'minimal',
          endpointLabel: 'openrouter',
          available: false,
          unavailableReason: 'Model discovery was temporarily unavailable.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  ]);

  const result = await runCopilotReview(
    launcherOptions(fixture, env, {
      endpointLabel: 'openrouter',
      modelId: 'unavailable-model',
      reasoningEffort: 'minimal',
    }),
  );

  assert.equal(result.launched, false);
  assert.equal(result.status, 'unavailable');
  await assert.rejects(
    fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as {
    provider_mode?: string;
    model_id?: string;
    failure_reason?: string;
    review?: string | null;
  };
  assert.equal(normalized.provider_mode, 'external');
  assert.equal(normalized.model_id, 'unavailable-model');
  assert.equal(normalized.review, null);
  assert.equal(
    normalized.failure_reason,
    'Model discovery was temporarily unavailable.',
  );
  assert.equal(await fs.readFile(fixture.outputPaths.stdoutPath, 'utf8'), '');
  await Promise.all(
    artifactPaths(fixture).map((filePath) => fs.access(filePath)),
  );
});

test('external endpoint identity drift is unavailable before credential or model discovery', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const replacementSecret = 'sk-replacement-secret';
  const env = fakeEnvironment(fixture, fakeCopilot, {
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
      'Unsloth,https://replacement.test/v1|completions',
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: `Unsloth,${replacementSecret}`,
  });
  let discoveryCalls = 0;
  const result = await runCopilotReview(
    launcherOptions(fixture, env, {
      endpointLabel: 'unsloth',
      endpointId: 'https://selected.test/v1',
      modelId: 'google-gemini-3.6-flash',
      reasoningEffort: 'minimal',
    }),
    {
      discoverExternalModels: async () => {
        discoveryCalls += 1;
        return ['google-gemini-3.6-flash'];
      },
    },
  );
  assert.equal(result.launched, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(discoveryCalls, 0);
  await assert.rejects(
    fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
  const persisted = (
    await Promise.all(
      artifactPaths(fixture).map((file) => fs.readFile(file, 'utf8')),
    )
  ).join('\n');
  assert.match(persisted, /external endpoint identity changed before launch/iu);
  assert.doesNotMatch(persisted, new RegExp(replacementSecret, 'u'));
  assert.doesNotMatch(persisted, /https:\/\/replacement\.test/u);
});

test('malformed external configuration is unavailable without leaking raw configuration', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const secret = 'sk-malformed-endpoint-secret';
  const env = fakeEnvironment(fixture, fakeCopilot, {
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: `malformed-${secret}`,
  });
  const result = await runCopilotReview(
    launcherOptions(fixture, env, {
      endpointLabel: 'openrouter',
      endpointId: 'https://openrouter.test/v1',
      modelId: 'model',
    }),
  );
  assert.equal(result.launched, false);
  assert.equal(result.status, 'unavailable');
  await assert.rejects(
    fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
  const persisted = (
    await Promise.all(
      artifactPaths(fixture).map((file) => fs.readFile(file, 'utf8')),
    )
  ).join('\n');
  assert.doesNotMatch(persisted, new RegExp(secret, 'u'));
  assert.match(
    persisted,
    /External endpoint configuration could not be resolved/u,
  );
});

test('external endpoint label and identity must be supplied together', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot);

  await assert.rejects(
    runCopilotReview(
      launcherOptions(fixture, env, { endpointLabel: 'openrouter' }),
    ),
    /must be supplied together/u,
  );
  await assert.rejects(
    runCopilotReview(
      launcherOptions(fixture, env, {
        endpointId: 'https://openrouter.test/v1',
      }),
    ),
    /must be supplied together/u,
  );
  const embeddedSecret = 'endpoint-password-secret';
  await assert.rejects(
    runCopilotReview(
      launcherOptions(fixture, env, {
        endpointLabel: 'openrouter',
        endpointId: `https://user:${embeddedSecret}@openrouter.test/v1`,
      }),
    ),
    (error: unknown) => {
      assert.match(String(error), /credentials are not allowed/u);
      assert.doesNotMatch(String(error), new RegExp(embeddedSecret, 'u'));
      return true;
    },
  );
  await assert.rejects(
    fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
});

test('pinned-head mismatch is rejected before Copilot invocation', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot);
  const result = await runCopilotReview(
    launcherOptions(fixture, env, { headCommit: fixture.base }),
  );
  assert.equal(result.launched, false);
  assert.equal(result.status, 'failed');
  await assert.rejects(
    fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
  assert.match(
    await fs.readFile(fixture.outputPaths.stderrPath, 'utf8'),
    /HEAD does not match/u,
  );
});

test('timeout terminates one launched Copilot process and preserves partial output', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot, {
    FAKE_COPILOT_STDOUT:
      '{"type":"assistant.message","data":{"content":"Partial before timeout"}}\\n',
    FAKE_COPILOT_WAIT: '1',
    CODEINFO_COPILOT_REVIEW_TIMEOUT_SEC: '0.05',
  });
  const result = await runCopilotReview(launcherOptions(fixture, env));
  assert.equal(result.launched, true);
  assert.equal(result.exitStatus, 124);
  assert.equal(result.status, 'timed_out');
  assert.equal(
    JSON.parse(
      await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
    ).status,
    'timed_out',
  );
  assert.match(
    await fs.readFile(fixture.outputPaths.stderrPath, 'utf8'),
    /timed out/u,
  );
  assert.equal(
    (await fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8')).trim(),
    'launch',
  );
});

test('review timeout resolution clamps option and environment values to the supported timer delay', () => {
  assert.equal(
    resolveCopilotReviewTimeoutMs({ timeoutMs: 2_147_483_648 }, {}),
    2_147_483_647,
  );
  assert.equal(
    resolveCopilotReviewTimeoutMs(
      {},
      { CODEINFO_COPILOT_REVIEW_TIMEOUT_SEC: '2147483.648' },
    ),
    2_147_483_647,
  );
});

test('abort terminates one launched Copilot process without losing diagnostics', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot, {
    FAKE_COPILOT_STDOUT: '',
    FAKE_COPILOT_WAIT: '1',
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const result = await runCopilotReview(
    launcherOptions(fixture, env, {
      signal: controller.signal,
      timeoutMs: 5_000,
    }),
  );
  assert.equal(result.launched, true);
  assert.equal(result.exitStatus, 130);
  assert.equal(result.status, 'cancelled');
  assert.equal(
    JSON.parse(
      await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
    ).status,
    'cancelled',
  );
  assert.match(
    await fs.readFile(fixture.outputPaths.stderrPath, 'utf8'),
    /cancelled/u,
  );
  assert.equal(
    (await fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8')).trim(),
    'launch',
  );
});

test('abort during external setup returns cancelled without spawning Copilot', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot, {
    CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
      'Unsloth,https://selected.test/v1|completions',
  });
  const controller = new AbortController();
  let releaseDiscovery!: () => void;
  const discoveryGate = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  let discoveryStarted!: () => void;
  const discoveryStartedSignal = new Promise<void>((resolve) => {
    discoveryStarted = resolve;
  });
  const execution = runCopilotReview(
    launcherOptions(fixture, env, {
      endpointLabel: 'unsloth',
      endpointId: 'https://selected.test/v1',
      modelId: 'google-gemini-3.6-flash',
      reasoningEffort: 'minimal',
      signal: controller.signal,
    }),
    {
      discoverExternalModels: async () => {
        discoveryStarted();
        await discoveryGate;
        return ['google-gemini-3.6-flash'];
      },
    },
  );

  await discoveryStartedSignal;
  controller.abort();
  const result = await execution;
  releaseDiscovery();

  assert.equal(result.launched, false);
  assert.equal(result.exitStatus, 130);
  assert.equal(result.status, 'cancelled');
  await assert.rejects(
    fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8'),
    /ENOENT/u,
  );
  assert.equal(
    JSON.parse(
      await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
    ).status,
    'cancelled',
  );
});

test('force-kill cancellation waits for the child close event', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot);
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killCalls: [] as NodeJS.Signals[],
    kill(signal: NodeJS.Signals) {
      this.killCalls.push(signal);
      return true;
    },
  });
  const controller = new AbortController();
  let childSpawned!: () => void;
  const childSpawnedSignal = new Promise<void>((resolve) => {
    childSpawned = resolve;
  });
  let settled = false;
  const execution = runCopilotReview(
    launcherOptions(fixture, env, { signal: controller.signal }),
    {
      spawn: () => {
        childSpawned();
        return child as never;
      },
    },
  ).then((result) => {
    settled = true;
    return result;
  });

  await childSpawnedSignal;
  controller.abort();
  await new Promise<void>((resolve) => setTimeout(resolve, 5_100));

  assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL']);
  assert.equal(settled, false);
  child.emit('close', null);
  const result = await execution;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.exitStatus, 130);
});

test('CLI derives artifacts from semantic arguments and the assigned workspace', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const fakeCopilot = await makeFakeCopilot(fixture.root);
  const env = fakeEnvironment(fixture, fakeCopilot);
  const launcher = fileURLToPath(
    new URL('../../copilot/reviewLauncherCli.js', import.meta.url),
  );

  execFileSync(
    process.execPath,
    [
      launcher,
      '--repository',
      fixture.repo,
      '--workspace',
      fixture.workspace,
      '--target-id',
      'repository-a',
      '--review-wave-id',
      'review-wave-1',
      '--job-instance-id',
      'copilot-model:repository-a:copilot_review',
      '--base',
      fixture.base,
      '--head',
      fixture.head,
      '--model',
      'gpt-5.4',
      '--reasoning-effort',
      'low',
    ],
    {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  assert.equal(
    (await fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8')).trim(),
    'launch',
  );
  await Promise.all(
    artifactPaths(fixture).map((filePath) => fs.access(filePath)),
  );
});

test('CLI argument parsing errors stay inside the launcher error boundary', () => {
  const launcher = fileURLToPath(
    new URL('../../copilot/reviewLauncherCli.js', import.meta.url),
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [launcher, '--stdout', '/tmp/wrong'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (error: unknown) => {
      const failure = error as {
        status?: number;
        stderr?: string | Buffer;
      };
      assert.equal(failure.status, 2);
      const stderr = String(failure.stderr);
      assert.match(stderr, /Unknown option.*stdout/u);
      assert.doesNotMatch(stderr, /reviewLauncherCli\.(?:js|ts):\d+/u);
      return true;
    },
  );
});
