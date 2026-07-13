import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  resolveCodexReviewModel,
  runCodexReviewStep,
} from '../../flows/codexReview.js';

const HEAD_SHA = 'd30c1246d30c1246d30c1246d30c1246d30c1246';
const BASE_SHA = 'a10ca1b2a10ca1b2a10ca1b2a10ca1b2a10ca1b2';
const CONTEXT_MARKDOWN = [
  '## Overview\n\nReview the intended behavior.',
  '## Acceptance Criteria\n\n- The change works.',
  '## Out Of Scope\n\n- Planning files.',
].join('\n\n');
const CONTEXT_SHA = crypto
  .createHash('sha256')
  .update(CONTEXT_MARKDOWN)
  .digest('hex');
const PLAN_CONTENT =
  '# Story\n\n## Overview\n\nReview the intended behavior.\n';
const PLAN_SHA = crypto.createHash('sha256').update(PLAN_CONTENT).digest('hex');
const REVIEW_SESSION_ID = '0000027-rs-20260705T160000Z-d30c1246-session';
const REVIEW_PASS_ID = '0000027-20260705T160000Z-d30c1246-session';
const PARENT_EXECUTION_ID = 'parent-execution-27';

const preparedIdentity = (comparisonBaseCommit = BASE_SHA) => ({
  schema_version: 2,
  story_id: '0000027',
  plan_path: 'planning/0000027-codex-review.md',
  review_session_id: REVIEW_SESSION_ID,
  review_pass_id: REVIEW_PASS_ID,
  parent_execution_id: PARENT_EXECUTION_ID,
  head_commit: HEAD_SHA,
  comparison_base_commit: comparisonBaseCommit,
});

const prepareReviewContext = async (params: {
  repoRoot: string;
  storyNumber: string;
  planPath: string;
  branch: string;
}) => {
  const artifactPath = path.join(
    params.repoRoot,
    'codeInfoTmp',
    'reviews',
    `${params.storyNumber}-current-review-context.json`,
  );
  const artifact = {
    schema_version: 'codeinfo-review-context/v1' as const,
    story_id: params.storyNumber,
    plan_path: params.planPath,
    branch: params.branch,
    source_plan_sha256: PLAN_SHA,
    context_sha256: CONTEXT_SHA,
    sections: {
      overview: {
        source_heading: 'Overview',
        markdown: '## Overview\n\nReview the intended behavior.',
      },
      acceptance_criteria: {
        source_heading: 'Acceptance Criteria',
        markdown: '## Acceptance Criteria\n\n- The change works.',
      },
      out_of_scope: {
        source_heading: 'Out Of Scope',
        markdown: '## Out Of Scope\n\n- Planning files.',
      },
    },
    excluded_paths: ['planning/**'],
    warnings: [],
    status: 'completed' as const,
  };
  const planFile = path.join(params.repoRoot, params.planPath);
  await fs.mkdir(path.dirname(planFile), { recursive: true });
  await fs.writeFile(planFile, PLAN_CONTENT);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, JSON.stringify(artifact));
  return { artifactPath, artifact };
};

test('resolveCodexReviewModel prefers explicit request model over step default', () => {
  assert.equal(
    resolveCodexReviewModel({
      requestedModelId: 'gpt-5.4',
      stepModelId: 'gpt-5.4-mini',
    }),
    'gpt-5.4',
  );
  assert.equal(
    resolveCodexReviewModel({
      requestedModelId: undefined,
      stepModelId: 'gpt-5.4-mini',
    }),
    'gpt-5.4-mini',
  );
  assert.equal(
    resolveCodexReviewModel({
      requestedModelId: undefined,
      stepModelId: undefined,
    }),
    null,
  );
});

test('runCodexReviewStep writes a stable pointer file using the server-owned prepared pass instead of a stale current-review pass', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-'),
  );
  const previousCodeInfoCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    const configuredCodexHome = path.join(repoRoot, 'configured-codex-home');
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    process.env.CODEINFO_CODEX_HOME = configuredCodexHome;
    delete process.env.CODEX_HOME;
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review.json',
      ),
      JSON.stringify({
        review_pass_id: '0000027-rp-20260705T150000Z-abcd1234',
      }),
    );

    const controller = new AbortController();
    const gitCalls: Array<{
      args: readonly string[];
      options:
        | {
            signal?: AbortSignal;
            timeout?: number;
            killSignal?: NodeJS.Signals | number;
            env?: NodeJS.ProcessEnv;
          }
        | undefined;
    }> = [];
    const codexCalls: Array<{
      args: readonly string[];
      options:
        | {
            signal?: AbortSignal;
            timeout?: number;
            killSignal?: NodeJS.Signals | number;
            maxBuffer?: number;
            env?: NodeJS.ProcessEnv;
          }
        | undefined;
    }> = [];
    const execFile = async (
      file: string,
      args: readonly string[],
      options?: {
        signal?: AbortSignal;
        timeout?: number;
        killSignal?: NodeJS.Signals | number;
        maxBuffer?: number;
      },
    ) => {
      if (file === 'git') {
        gitCalls.push({ args, options });
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T160455Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T160455Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        codexCalls.push({ args, options });
        const outputIndex = args.indexOf('-o');
        assert.notEqual(outputIndex, -1);
        const outputPath = String(args[outputIndex + 1]);
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
        reasoningEffort: 'high',
        signal: controller.signal,
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:04:55.000Z'),
        randomHex: () => '7f3a1c2b',
      },
    );

    assert.equal(codexCalls.length, 1);
    assert.deepEqual(codexCalls[0]?.args.slice(0, 11), [
      'exec',
      '--ignore-user-config',
      '--disable',
      'apps',
      '--sandbox',
      'danger-full-access',
      '-C',
      repoRoot,
      '-m',
      'gpt-5.4',
      '-o',
    ]);
    assert.ok(codexCalls[0]?.args.includes('gpt-5.4'));
    assert.equal(codexCalls[0]?.args.includes('review_model="gpt-5.4"'), false);
    assert.ok(codexCalls[0]?.args.includes('approval_policy="never"'));
    assert.ok(
      codexCalls[0]?.args.includes('model_reasoning_effort="high"'),
      'codex exec review should forward the configured reasoning effort',
    );
    const customPrompt = String(codexCalls[0]?.args.at(-1));
    assert.match(
      customPrompt,
      /refs\/codeinfo\/review-bases\/0000027-20260705T160455Z-7f3a1c2b\.\.\.HEAD/u,
    );
    assert.match(customPrompt, /ignore planning\/\*\*/u);
    assert.match(customPrompt, /Use only local Git and filesystem commands/u);
    assert.match(customPrompt, /Do not modify files, refs, commits, branches/u);
    assert.match(customPrompt, /Review the intended behavior/u);
    assert.match(customPrompt, /The change works/u);
    assert.match(customPrompt, /untrusted data/u);
    assert.equal(codexCalls[0]?.options?.signal, controller.signal);
    assert.equal(codexCalls[0]?.options?.timeout, 1_800_000);
    assert.equal(codexCalls[0]?.options?.killSignal, 'SIGTERM');
    assert.equal(codexCalls[0]?.options?.maxBuffer, 16 * 1024 * 1024);
    assert.equal(
      codexCalls[0]?.options?.env?.CODEX_HOME,
      configuredCodexHome,
      'codex exec review should receive the resolved CODEX_HOME',
    );
    assert.ok(gitCalls.length > 0);
    assert.equal(gitCalls[0]?.options?.signal, controller.signal);
    assert.equal(gitCalls[0]?.options?.timeout, 120_000);
    assert.equal(gitCalls[0]?.options?.killSignal, 'SIGTERM');

    const pointerRaw = await fs.readFile(result.pointerPath, 'utf8');
    const pointer = JSON.parse(pointerRaw) as {
      codex_review_pass_id: string;
      review_output_file: string;
      reasoning_effort: string | null;
      remote_fetch_status: string;
      resolved_base_source: string;
      local_fallback_reason: string | null;
      canonical_review_pass_id: string | null;
      review_context_file: string;
      review_context_sha256: string;
      review_excluded_paths: string[];
    };

    assert.equal(
      path.basename(result.pointerPath),
      '0000027-current-codex-review.json',
    );
    assert.ok(
      pointer.codex_review_pass_id.startsWith(
        '0000027-20260705T160455Z-d30c1246d3-7f3a1c2b-codex-',
      ),
    );
    assert.equal(
      pointer.canonical_review_pass_id,
      '0000027-20260705T160455Z-d30c1246d3-7f3a1c2b',
    );
    assert.notEqual(
      pointer.canonical_review_pass_id,
      '0000027-rp-20260705T150000Z-abcd1234',
    );
    assert.equal(pointer.reasoning_effort, 'high');
    assert.equal(pointer.remote_fetch_status, 'success');
    assert.equal(pointer.resolved_base_source, 'remote');
    assert.equal(pointer.local_fallback_reason, null);
    assert.equal(
      pointer.review_context_file,
      'codeInfoTmp/reviews/0000027-current-review-context.json',
    );
    assert.equal(pointer.review_context_sha256, CONTEXT_SHA);
    assert.deepEqual(pointer.review_excluded_paths, ['planning/**']);
    assert.ok(pointer.review_output_file.endsWith('-codex-review.md'));
  } finally {
    if (previousCodeInfoCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = previousCodeInfoCodexHome;
    }
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep deletes the pinned review-base ref even when codex aborts', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-abort-cleanup-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const controller = new AbortController();
    let cleanupSignal: AbortSignal | undefined;
    const gitCalls: string[] = [];
    const execFile = async (
      file: string,
      args: readonly string[],
      options?: {
        signal?: AbortSignal;
        timeout?: number;
        killSignal?: NodeJS.Signals | number;
        maxBuffer?: number;
      },
    ) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        gitCalls.push(key);
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T160500Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              assert.equal(options?.signal, controller.signal);
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T160500Z-',
              )
            ) {
              cleanupSignal = options?.signal;
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        controller.abort();
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    await assert.rejects(
      runCodexReviewStep(
        {
          workingRepositoryPath: repoRoot,
          outputKey: 'current-codex-review',
          modelId: 'gpt-5.4',
          signal: controller.signal,
        },
        {
          execFile,
          prepareReviewContext,
          now: () => new Date('2026-07-05T16:05:00.000Z'),
          randomHex: () => '9abc1234',
        },
      ),
      (error) => (error as Error).name === 'AbortError',
    );

    assert.equal(cleanupSignal, undefined);
    assert.ok(
      gitCalls.some((key) =>
        key.startsWith(
          'update-ref -d refs/codeinfo/review-bases/0000027-20260705T160500Z-',
        ),
      ),
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep deletes the pinned review-base ref when review setup fails after ref creation', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-setup-cleanup-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review-base.json',
      ),
      JSON.stringify({
        ...preparedIdentity(),
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
        repo_alias: 'current_repository',
        repo_root: repoRoot,
        branch: 'feature/0000027-codex-review',
        head_commit: HEAD_SHA,
        logical_base_branch: 'main',
        resolved_base_branch: 'main',
        resolved_base_source: 'remote',
        remote_name: 'origin',
        remote_fetch_status: 'success',
        local_fallback_reason: null,
        comparison_base_ref: 'origin/main',
        comparison_base_commit: BASE_SHA,
        comparison_head_ref: 'HEAD',
        comparison_rule: 'local_head_vs_resolved_base',
        status: 'completed',
        started_at: '2026-07-05T16:05:00.000Z',
        completed_at: '2026-07-05T16:05:01.000Z',
      }),
    );

    const setupError = Object.assign(new Error('mkdir failed'), {
      code: 'ENOSPC',
    });
    let cleanupAttempted = false;
    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T160505Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T160505Z-',
              )
            ) {
              cleanupAttempted = true;
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    await assert.rejects(
      runCodexReviewStep(
        {
          workingRepositoryPath: repoRoot,
          outputKey: 'current-codex-review',
          modelId: 'gpt-5.4',
        },
        {
          execFile,
          prepareReviewContext,
          mkdir: async () => {
            throw setupError;
          },
          now: () => new Date('2026-07-05T16:05:05.000Z'),
          randomHex: () => '6abc1234',
        },
      ),
      (error) => error === setupError,
    );

    assert.equal(cleanupAttempted, true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep throws cleanup failures after a successful codex run', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-cleanup-failure-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const cleanupError = new Error('cleanup failed');
    let cleanupAttempted = false;
    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T160510Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T160510Z-',
              )
            ) {
              cleanupAttempted = true;
              throw cleanupError;
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        const outputIndex = args.indexOf('-o');
        assert.notEqual(outputIndex, -1);
        const outputPath = String(args[outputIndex + 1]);
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    await assert.rejects(
      runCodexReviewStep(
        {
          workingRepositoryPath: repoRoot,
          outputKey: 'current-codex-review',
          modelId: 'gpt-5.4',
        },
        {
          execFile,
          prepareReviewContext,
          now: () => new Date('2026-07-05T16:05:10.000Z'),
          randomHex: () => '8abc1234',
        },
      ),
      (error) =>
        error instanceof Error &&
        error.message.includes('Unable to delete pinned review base ref'),
    );
    assert.equal(cleanupAttempted, true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep preserves the codex failure when cleanup also fails', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-dual-failure-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const codexError = new Error('codex failed');
    const cleanupError = new Error('cleanup failed');
    let cleanupAttempted = false;
    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T160520Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T160520Z-',
              )
            ) {
              cleanupAttempted = true;
              throw cleanupError;
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        throw codexError;
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    await assert.rejects(
      runCodexReviewStep(
        {
          workingRepositoryPath: repoRoot,
          outputKey: 'current-codex-review',
          modelId: 'gpt-5.4',
        },
        {
          execFile,
          prepareReviewContext,
          now: () => new Date('2026-07-05T16:05:20.000Z'),
          randomHex: () => '7abc1234',
        },
      ),
      (error) => error === codexError,
    );
    assert.equal(cleanupAttempted, true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep consumes the prepared current-review-base artifact when present', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-prepared-base-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review-base.json',
      ),
      JSON.stringify({
        ...preparedIdentity(),
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
        repo_alias: 'current_repository',
        repo_root: repoRoot,
        branch: 'feature/0000027-codex-review',
        head_commit: HEAD_SHA,
        logical_base_branch: 'main',
        resolved_base_branch: 'main',
        resolved_base_source: 'remote',
        remote_name: 'origin',
        remote_fetch_status: 'success',
        local_fallback_reason: null,
        comparison_base_ref: 'origin/main',
        comparison_base_commit: BASE_SHA,
        comparison_head_ref: 'HEAD',
        comparison_rule: 'local_head_vs_resolved_base',
        status: 'completed',
        started_at: '2026-07-05T16:20:00.000Z',
        completed_at: '2026-07-05T16:20:01.000Z',
      }),
    );

    const gitCalls: string[] = [];
    const codexCalls: Array<readonly string[]> = [];
    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        gitCalls.push(key);
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T162100Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T162100Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        codexCalls.push(args);
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:21:00.000Z'),
        randomHex: () => '01020304',
      },
    );

    assert.deepEqual(gitCalls, [
      'rev-parse --show-toplevel',
      'branch --show-current',
      'rev-parse HEAD^{commit}',
      'rev-parse --show-toplevel',
      'rev-parse --short HEAD^{commit}',
      'update-ref refs/codeinfo/review-bases/0000027-20260705T162100Z-01020304 a10ca1b2a10ca1b2a10ca1b2a10ca1b2a10ca1b2',
      'update-ref -d refs/codeinfo/review-bases/0000027-20260705T162100Z-01020304',
      'rev-parse --show-toplevel',
    ]);
    assert.equal(codexCalls.length, 1);
    assert.deepEqual(codexCalls[0]?.slice(0, 11), [
      'exec',
      '--ignore-user-config',
      '--disable',
      'apps',
      '--sandbox',
      'danger-full-access',
      '-C',
      repoRoot,
      '-m',
      'gpt-5.4',
      '-o',
    ]);
    assert.match(
      String(codexCalls[0]?.at(-1)),
      /refs\/codeinfo\/review-bases\/0000027-20260705T162100Z-01020304\.\.\.HEAD/u,
    );
    assert.equal(result.pointer.comparison_base_ref, 'origin/main');
    assert.equal(result.pointer.resolved_base_source, 'remote');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep resolves the git toplevel before reading current-plan and review artifacts', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-subdir-root-'),
  );
  const workingSubdir = path.join(repoRoot, 'server');
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.mkdir(workingSubdir, { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review-base.json',
      ),
      JSON.stringify({
        ...preparedIdentity(),
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
        repo_alias: 'current_repository',
        repo_root: repoRoot,
        branch: 'feature/0000027-codex-review',
        head_commit: HEAD_SHA,
        logical_base_branch: 'main',
        resolved_base_branch: 'main',
        resolved_base_source: 'remote',
        remote_name: 'origin',
        remote_fetch_status: 'success',
        local_fallback_reason: null,
        comparison_base_ref: 'origin/main',
        comparison_base_commit: BASE_SHA,
        comparison_head_ref: 'HEAD',
        comparison_rule: 'local_head_vs_resolved_base',
        status: 'completed',
        started_at: '2026-07-05T16:23:00.000Z',
        completed_at: '2026-07-05T16:23:01.000Z',
      }),
    );

    const gitCalls: string[] = [];
    const codexCalls: Array<readonly string[]> = [];
    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        gitCalls.push(key);
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T162300Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T162300Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        codexCalls.push(args);
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: workingSubdir,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:23:00.000Z'),
        randomHex: () => '11223344',
      },
    );

    assert.equal(result.pointer.repo_root, repoRoot);
    assert.deepEqual(codexCalls[0]?.slice(0, 9), [
      'exec',
      '--ignore-user-config',
      '--disable',
      'apps',
      '--sandbox',
      'danger-full-access',
      '-C',
      repoRoot,
      '-m',
    ]);
    assert.ok(gitCalls.includes('rev-parse --show-toplevel'));
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep ignores malformed stale current-review pass ids', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-sanitized-pass-id-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review.json',
      ),
      JSON.stringify({
        review_pass_id: '../odd pass/id',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T162200Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T162200Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        assert.equal(
          path.basename(outputPath).startsWith('odd-pass-id-codex-'),
          false,
        );
        assert.ok(!outputPath.includes('..'));
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:22:00.000Z'),
        randomHex: () => 'abcdef01',
      },
    );

    assert.equal(
      result.pointer.codex_review_pass_id.startsWith('odd-pass-id-codex-'),
      false,
    );
    assert.match(result.pointer.canonical_review_pass_id, /^0000027-/u);
    assert.notEqual(result.pointer.canonical_review_pass_id, '../odd pass/id');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep ignores stale review cycle ids from a different story when seeding artifact names', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-stale-review-cycle-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoStatus',
        'flow-state',
        'review-disposition-state.json',
      ),
      JSON.stringify({
        story_number: '0000057',
        review_cycle_id: '0000057-rc-20260517T051958Z-9b052d08',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260706T091129Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260706T091129Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-06T09:11:29.071Z'),
        randomHex: () => '08185125',
      },
    );

    assert.equal(result.pointer.review_cycle_id, null);
    assert.ok(
      result.pointer.codex_review_pass_id.startsWith(
        '0000027-20260706T091129Z-d30c1246d3-08185125-codex-',
      ),
    );
    assert.ok(
      result.reviewOutputPath.endsWith(
        `${result.pointer.codex_review_pass_id}-codex-review.md`,
      ),
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep reuses a prepared review base artifact even when the tracked base ref has advanced', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-stale-prepared-base-'),
  );
  const staleBaseSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review-base.json',
      ),
      JSON.stringify({
        ...preparedIdentity(staleBaseSha),
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
        repo_alias: 'current_repository',
        repo_root: repoRoot,
        branch: 'feature/0000027-codex-review',
        head_commit: HEAD_SHA,
        logical_base_branch: 'main',
        resolved_base_branch: 'main',
        resolved_base_source: 'remote',
        remote_name: 'origin',
        remote_fetch_status: 'success',
        local_fallback_reason: null,
        comparison_base_ref: 'origin/main',
        comparison_base_commit: staleBaseSha,
        comparison_head_ref: 'HEAD',
        comparison_rule: 'local_head_vs_resolved_base',
        status: 'completed',
        started_at: '2026-07-05T16:24:00.000Z',
        completed_at: '2026-07-05T16:24:01.000Z',
      }),
    );

    const gitCalls: string[] = [];
    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        gitCalls.push(key);
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T162500Z-',
              ) &&
              key.endsWith(` ${staleBaseSha}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T162500Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:25:00.000Z'),
        randomHex: () => '55667788',
      },
    );

    assert.equal(result.pointer.comparison_base_commit, staleBaseSha);
    assert.ok(!gitCalls.includes('remote get-url origin'));
    assert.ok(!gitCalls.includes('fetch --prune origin'));
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep refreshes a prepared review base artifact when current-plan branched_from changes', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-branched-from-refresh-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );
    await fs.writeFile(
      path.join(
        repoRoot,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review-base.json',
      ),
      JSON.stringify({
        ...preparedIdentity('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'feature/shared-base',
        repo_alias: 'current_repository',
        repo_root: repoRoot,
        branch: 'feature/0000027-codex-review',
        head_commit: HEAD_SHA,
        logical_base_branch: 'feature/shared-base',
        resolved_base_branch: 'feature/shared-base',
        resolved_base_source: 'local_fallback',
        remote_name: 'origin',
        remote_fetch_status: 'missing_remote_ref',
        local_fallback_reason: 'missing_remote_ref',
        comparison_base_ref: 'feature/shared-base',
        comparison_base_commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        comparison_head_ref: 'HEAD',
        comparison_rule: 'local_head_vs_resolved_base',
        status: 'completed',
        started_at: '2026-07-05T16:24:00.000Z',
        completed_at: '2026-07-05T16:24:01.000Z',
      }),
    );

    const gitCalls: string[] = [];
    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        gitCalls.push(key);
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/main':
          case 'rev-parse origin/main^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T162600Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T162600Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        await fs.writeFile(outputPath, '# Codex Review\n\nNo issues.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:26:00.000Z'),
        randomHex: () => '99aabbcc',
      },
    );

    assert.equal(result.pointer.comparison_base_commit, BASE_SHA);
    assert.ok(gitCalls.includes('remote get-url origin'));
    assert.ok(gitCalls.includes('fetch --prune origin'));
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep falls back to a local branched-from ref when origin is unavailable', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-local-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'feature/shared-base',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            throw Object.assign(new Error('no origin'), {
              code: 128,
              stdout: '',
              stderr: 'no origin',
            });
          case 'rev-parse --verify main':
          case 'rev-parse --verify feature/shared-base':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'merge-base --is-ancestor feature/shared-base main':
            throw Object.assign(new Error('not merged'), {
              code: 1,
              stdout: '',
              stderr: '',
            });
          case 'merge-base --is-ancestor feature/shared-base HEAD':
            return { stdout: '', stderr: '' };
          case 'rev-parse feature/shared-base^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T161000Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T161000Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, '# Codex Review\n\nOne issue.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4-mini',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:10:00.000Z'),
        randomHex: () => '1a2b3c4d',
      },
    );

    assert.equal(result.pointer.logical_base_branch, 'feature/shared-base');
    assert.equal(result.pointer.resolved_base_branch, 'feature/shared-base');
    assert.equal(result.pointer.resolved_base_source, 'local_fallback');
    assert.equal(result.pointer.remote_fetch_status, 'missing_remote');
    assert.equal(result.pointer.local_fallback_reason, 'missing_remote');
    assert.equal(result.pointer.comparison_base_ref, 'feature/shared-base');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep falls back to a local branched-from ref when origin fetch succeeds but the remote parent ref is absent', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-missing-remote-parent-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'feature/shared-base',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'rev-parse --show-toplevel':
            return { stdout: `${repoRoot}\n`, stderr: '' };
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return {
              stdout: 'git@github.com:Chargeuk/codeInfo2.git\n',
              stderr: '',
            };
          case 'fetch --prune origin':
            return { stdout: '', stderr: '' };
          case 'symbolic-ref --short refs/remotes/origin/HEAD':
            return { stdout: 'origin/main\n', stderr: '' };
          case 'rev-parse --verify origin/feature/shared-base':
            throw Object.assign(new Error('missing remote parent'), {
              code: 128,
              stdout: '',
              stderr: 'missing remote parent',
            });
          case 'rev-parse --verify origin/main':
          case 'rev-parse --verify main':
          case 'rev-parse --verify feature/shared-base':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'merge-base --is-ancestor feature/shared-base main':
            throw Object.assign(new Error('not merged'), {
              code: 1,
              stdout: '',
              stderr: '',
            });
          case 'merge-base --is-ancestor feature/shared-base HEAD':
            return { stdout: '', stderr: '' };
          case 'rev-parse feature/shared-base^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
            if (
              key.startsWith(
                'update-ref refs/codeinfo/review-bases/0000027-20260705T161200Z-',
              ) &&
              key.endsWith(` ${BASE_SHA}`)
            ) {
              return { stdout: '', stderr: '' };
            }
            if (
              key.startsWith(
                'update-ref -d refs/codeinfo/review-bases/0000027-20260705T161200Z-',
              )
            ) {
              return { stdout: '', stderr: '' };
            }
            throw Object.assign(new Error(`unexpected git command: ${key}`), {
              code: 128,
              stdout: '',
              stderr: `unexpected git command: ${key}`,
            });
        }
      }

      if (file === 'codex') {
        const outputIndex = args.indexOf('-o');
        const outputPath = String(args[outputIndex + 1]);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, '# Codex Review\n\nOne issue.\n');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected executable: ${file}`);
    };

    const result = await runCodexReviewStep(
      {
        workingRepositoryPath: repoRoot,
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4-mini',
      },
      {
        execFile,
        prepareReviewContext,
        now: () => new Date('2026-07-05T16:12:00.000Z'),
        randomHex: () => '4d3c2b1a',
      },
    );

    assert.equal(result.pointer.logical_base_branch, 'feature/shared-base');
    assert.equal(result.pointer.resolved_base_branch, 'feature/shared-base');
    assert.equal(result.pointer.resolved_base_source, 'local_fallback');
    assert.equal(result.pointer.remote_fetch_status, 'missing_remote_ref');
    assert.equal(result.pointer.local_fallback_reason, 'missing_remote_ref');
    assert.equal(result.pointer.comparison_base_ref, 'feature/shared-base');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep rejects unsupported basePolicy values', async () => {
  await assert.rejects(
    runCodexReviewStep(
      {
        workingRepositoryPath: '/tmp/unused-codex-review',
        outputKey: 'current-codex-review',
        modelId: 'gpt-5.4',
        basePolicy: 'unsupported' as 'branched_from_or_default_if_merged',
      },
      {
        execFile: async (file, args) => {
          if (
            file === 'git' &&
            args.slice(2).join(' ') === 'rev-parse --show-toplevel'
          ) {
            return { stdout: '/tmp/unused-codex-review\n', stderr: '' };
          }
          throw new Error(`unexpected executable: ${file}`);
        },
      },
    ),
    /Unsupported codexReview basePolicy/u,
  );
});

test('runCodexReviewStep rejects when the current branch story does not match the active plan story', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-story-mismatch-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        if (key === 'rev-parse --show-toplevel') {
          return { stdout: `${repoRoot}\n`, stderr: '' };
        }
        if (key === 'branch --show-current') {
          return { stdout: 'feature/0000028-other-story\n', stderr: '' };
        }
      }
      throw new Error(`unexpected executable: ${file}`);
    };

    await assert.rejects(
      runCodexReviewStep(
        {
          workingRepositoryPath: repoRoot,
          outputKey: 'current-codex-review',
          modelId: 'gpt-5.4',
        },
        {
          execFile,
          prepareReviewContext,
        },
      ),
      /does not match plan story 0000027/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('runCodexReviewStep rejects non-story branches before writing review artifacts', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-non-story-'),
  );
  try {
    await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
    );

    const execFile = async (file: string, args: readonly string[]) => {
      if (file === 'git') {
        const key = args.slice(2).join(' ');
        if (key === 'rev-parse --show-toplevel') {
          return { stdout: `${repoRoot}\n`, stderr: '' };
        }
        if (key === 'branch --show-current') {
          return { stdout: 'main\n', stderr: '' };
        }
      }
      throw new Error(`unexpected executable: ${file}`);
    };

    await assert.rejects(
      runCodexReviewStep(
        {
          workingRepositoryPath: repoRoot,
          outputKey: 'current-codex-review',
          modelId: 'gpt-5.4',
        },
        { execFile },
      ),
      /does not match plan story 0000027/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
