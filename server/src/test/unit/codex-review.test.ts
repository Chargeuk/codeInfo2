import assert from 'node:assert/strict';
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

test('runCodexReviewStep writes a stable pointer file and uses the canonical current-review pass id when present', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codex-review-helper-'),
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
      path.join(repoRoot, 'codeInfoTmp', 'reviews', '0000027-current-review.json'),
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
      },
    ) => {
      if (file === 'git') {
        gitCalls.push({ args, options });
        const key = args.slice(2).join(' ');
        switch (key) {
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return { stdout: 'git@github.com:Chargeuk/codeInfo2.git\n', stderr: '' };
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
        now: () => new Date('2026-07-05T16:04:55.000Z'),
        randomHex: () => '7f3a1c2b',
      },
    );

    assert.equal(codexCalls.length, 1);
    assert.deepEqual(codexCalls[0]?.args.slice(0, 6), [
      'exec',
      'review',
      '-C',
      repoRoot,
      '--base',
      'origin/main',
    ]);
    assert.ok(codexCalls[0]?.args.includes('gpt-5.4'));
    assert.ok(
      codexCalls[0]?.args.includes('review_model="gpt-5.4"'),
      'codex exec review should force review_model to the selected model',
    );
    assert.ok(
      codexCalls[0]?.args.includes('model_reasoning_effort="high"'),
      'codex exec review should forward the configured reasoning effort',
    );
    assert.equal(codexCalls[0]?.options?.signal, controller.signal);
    assert.equal(codexCalls[0]?.options?.timeout, 1_800_000);
    assert.equal(codexCalls[0]?.options?.killSignal, 'SIGTERM');
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
    };

    assert.equal(
      path.basename(result.pointerPath),
      '0000027-current-codex-review.json',
    );
    assert.ok(
      pointer.codex_review_pass_id.startsWith(
        '0000027-rp-20260705T150000Z-abcd1234-codex-',
      ),
    );
    assert.equal(pointer.canonical_review_pass_id, '0000027-rp-20260705T150000Z-abcd1234');
    assert.equal(pointer.reasoning_effort, 'high');
    assert.equal(pointer.remote_fetch_status, 'success');
    assert.equal(pointer.resolved_base_source, 'remote');
    assert.equal(pointer.local_fallback_reason, null);
    assert.ok(pointer.review_output_file.endsWith('-codex-review.md'));
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
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
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
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
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
        now: () => new Date('2026-07-05T16:21:00.000Z'),
        randomHex: () => '01020304',
      },
    );

    assert.deepEqual(gitCalls, [
      'branch --show-current',
      'rev-parse HEAD^{commit}',
      'rev-parse --short HEAD^{commit}',
    ]);
    assert.equal(codexCalls.length, 1);
    assert.deepEqual(codexCalls[0]?.slice(0, 6), [
      'exec',
      'review',
      '-C',
      repoRoot,
      '--base',
      'origin/main',
    ]);
    assert.equal(result.pointer.comparison_base_ref, 'origin/main');
    assert.equal(result.pointer.resolved_base_source, 'remote');
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
          case 'rev-parse feature/shared-base^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
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
          case 'branch --show-current':
            return { stdout: 'feature/0000027-codex-review\n', stderr: '' };
          case 'remote get-url origin':
            return { stdout: 'git@github.com:Chargeuk/codeInfo2.git\n', stderr: '' };
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
          case 'rev-parse feature/shared-base^{commit}':
            return { stdout: `${BASE_SHA}\n`, stderr: '' };
          case 'rev-parse HEAD^{commit}':
            return { stdout: `${HEAD_SHA}\n`, stderr: '' };
          case 'rev-parse --short HEAD^{commit}':
            return { stdout: 'd30c1246\n', stderr: '' };
          default:
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
    runCodexReviewStep({
      workingRepositoryPath: '/tmp/unused-codex-review',
      outputKey: 'current-codex-review',
      modelId: 'gpt-5.4',
      basePolicy: 'unsupported' as 'branched_from_or_default_if_merged',
    }),
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
      if (file === 'git' && args.slice(2).join(' ') === 'branch --show-current') {
        return { stdout: 'feature/0000028-other-story\n', stderr: '' };
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
        },
      ),
      /does not match plan story 0000027/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
