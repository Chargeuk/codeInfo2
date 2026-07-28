import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COPILOT_REVIEW_GIT_INSPECTION_COMMANDS,
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

  const instructions = path.join(workspace, 'work', 'instructions.md');
  await fs.writeFile(instructions, 'Review the pinned diff. Do not edit.\n');
  const outputPaths = {
    stdoutPath: path.join(workspace, 'work', 'copilot.stdout.jsonl'),
    stderrPath: path.join(workspace, 'work', 'copilot.stderr.log'),
    exitStatusPath: path.join(workspace, 'work', 'copilot.exit.json'),
    invocationPath: path.join(workspace, 'work', 'copilot.invocation.json'),
    normalizedResultPath: path.join(workspace, 'output', 'copilot-review.json'),
    usagePath: path.join(
      workspace,
      'work',
      'review-usage',
      'native-copilot.json',
    ),
  };
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
  instructionsPath: fixture.instructions,
  outputPaths: fixture.outputPaths,
  env,
  ...overrides,
});

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

test('native launcher invokes local /review once with pinned read-only non-interactive arguments and closed stdin', async (t) => {
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
    '--available-tools=view,grep,glob,bash',
    '--allow-tool=read',
    '--deny-tool=write',
  ]) {
    assert.equal(args.includes(expected), true, expected);
  }
  assert.deepEqual(
    args.filter((arg) => arg.startsWith('--allow-tool=shell(git ')),
    COPILOT_REVIEW_GIT_INSPECTION_COMMANDS.map(
      (command) => `--allow-tool=shell(git ${command})`,
    ),
  );
  assert.equal(args.includes('--allow-tool=shell(git:*)'), false);
  for (const mutatingCommand of [
    'config',
    'notes',
    'replace',
    'update-ref',
    'worktree',
  ]) {
    assert.equal(
      args.includes(`--allow-tool=shell(git ${mutatingCommand})`),
      false,
      `git ${mutatingCommand} is not allowed`,
    );
  }
  assert.equal(args.includes('--allow-all'), false);
  assert.equal(args.includes('--allow-all-tools'), false);
  assert.equal(
    args.includes('--deny-tool=shell(git commit:*)'),
    true,
    'mutating Git commands are denied',
  );
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
  assert.match(
    childEnv,
    new RegExp(`COPILOT_HOME=${path.join(fixture.root, 'copilot-home')}`, 'u'),
  );
  assert.match(childEnv, /^GIT_OPTIONAL_LOCKS=0$/mu);
  assert.match(childEnv, /^GIT_TERMINAL_PROMPT=0$/mu);
  assert.match(childEnv, /^GIT_PAGER=cat$/mu);
  assert.match(childEnv, /^PAGER=cat$/mu);
  const artifacts = await Promise.all(
    Object.values(fixture.outputPaths).map((file) => fs.readFile(file, 'utf8')),
  );
  assert.doesNotMatch(artifacts.join('\n'), new RegExp(secret, 'u'));
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as {
    review?: string;
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
  const selectedSecret = 'sk-selected-secret';
  const otherSecret = 'sk-other-secret';
  const env = fakeEnvironment(fixture, fakeCopilot, {
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
  const childEnv = await fs.readFile(String(env.FAKE_COPILOT_ENV_FILE), 'utf8');
  assert.match(childEnv, /COPILOT_PROVIDER_TYPE=openai/u);
  assert.match(
    childEnv,
    /COPILOT_PROVIDER_BASE_URL=https:\/\/selected\.test\/v1/u,
  );
  assert.match(childEnv, /COPILOT_PROVIDER_WIRE_API=completions/u);
  assert.match(childEnv, /COPILOT_MODEL=google-gemini-3\.6-flash/u);
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
      Object.values(fixture.outputPaths).map((file) =>
        fs.readFile(file, 'utf8'),
      ),
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
  ) as { endpoint_id?: string };
  const normalized = JSON.parse(
    await fs.readFile(fixture.outputPaths.normalizedResultPath, 'utf8'),
  ) as { endpoint_id?: string };
  assert.equal(invocation.endpoint_id, 'https://selected.test/v1');
  assert.equal(normalized.endpoint_id, 'https://selected.test/v1');
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
      Object.values(fixture.outputPaths).map((file) =>
        fs.readFile(file, 'utf8'),
      ),
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
      Object.values(fixture.outputPaths).map((file) =>
        fs.readFile(file, 'utf8'),
      ),
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
  });
  const result = await runCopilotReview(
    launcherOptions(fixture, env, { timeoutMs: 50 }),
  );
  assert.equal(result.launched, true);
  assert.equal(result.exitStatus, 124);
  assert.equal(result.status, 'partial');
  assert.match(
    await fs.readFile(fixture.outputPaths.stderrPath, 'utf8'),
    /timed out/u,
  );
  assert.equal(
    (await fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8')).trim(),
    'launch',
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
  assert.equal(result.status, 'failed');
  assert.match(
    await fs.readFile(fixture.outputPaths.stderrPath, 'utf8'),
    /cancelled/u,
  );
  assert.equal(
    (await fs.readFile(String(env.FAKE_COPILOT_COUNT_FILE), 'utf8')).trim(),
    'launch',
  );
});

test('CLI argument parsing errors stay inside the launcher error boundary', () => {
  const launcher = fileURLToPath(
    new URL('../../copilot/reviewLauncherCli.js', import.meta.url),
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [launcher, '--unknown-option'], {
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
      assert.match(stderr, /Unknown option/u);
      assert.doesNotMatch(stderr, /reviewLauncherCli\.(?:js|ts):\d+/u);
      return true;
    },
  );
});
