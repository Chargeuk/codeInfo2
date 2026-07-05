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

    const codexCalls: Array<readonly string[]> = [];
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
        codexCalls.push(args);
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
      },
      {
        execFile,
        now: () => new Date('2026-07-05T16:04:55.000Z'),
        randomHex: () => '7f3a1c2b',
      },
    );

    assert.equal(codexCalls.length, 1);
    assert.deepEqual(codexCalls[0]?.slice(0, 6), [
      'exec',
      'review',
      '-C',
      repoRoot,
      '--base',
      'main',
    ]);
    assert.ok(codexCalls[0]?.includes('gpt-5.4'));
    assert.ok(
      codexCalls[0]?.includes('review_model="gpt-5.4"'),
      'codex exec review should force review_model to the selected model',
    );
    assert.ok(
      codexCalls[0]?.includes('model_reasoning_effort="high"'),
      'codex exec review should forward the configured reasoning effort',
    );

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
