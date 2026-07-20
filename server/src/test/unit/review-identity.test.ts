import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertReviewIdentityMatches,
  atomicWriteJson,
  buildReviewArtifactPath,
  createReviewIdentity,
  deriveCanonicalStoryId,
  readReviewIdentity,
  resolveContainedReviewArtifactPath,
} from '../../flows/reviewIdentity.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

test('review identity preserves the canonical padded story namespace', () => {
  const identity = createReviewIdentity({
    planPath: 'planning/0000013-example.md',
    headCommit: HEAD,
    comparisonBaseCommit: BASE,
    parentExecutionId: 'execution-13',
    now: new Date('2026-07-13T10:27:26.000Z'),
    randomHex: 'c0ffee12',
  });

  assert.equal(deriveCanonicalStoryId(identity.plan_path), '0000013');
  assert.equal(identity.story_id, '0000013');
  assert.match(identity.review_session_id, /^0000013-rs-/u);
  assert.match(identity.review_pass_id, /^0000013-/u);
  assert.equal(
    path.basename(
      buildReviewArtifactPath({
        repoRoot: '/tmp/example',
        storyId: identity.story_id,
        outputKey: 'current-review',
      }),
    ),
    '0000013-current-review.json',
  );
  assert.throws(
    () =>
      buildReviewArtifactPath({
        repoRoot: '/tmp/example',
        storyId: '13',
        outputKey: 'current-review',
      }),
    /Invalid canonical story ID/u,
  );
});

test('review identity rejects malformed and mismatched machine identity', () => {
  const expected = createReviewIdentity({
    planPath: 'planning/0000013-example.md',
    headCommit: HEAD,
    comparisonBaseCommit: BASE,
    parentExecutionId: 'execution-13',
    now: new Date('2026-07-13T10:27:26.000Z'),
    randomHex: 'c0ffee12',
  });
  assert.throws(
    () =>
      readReviewIdentity({
        ...expected,
        review_pass_id: '../odd pass/id',
      }),
    /Invalid/u,
  );
  assert.throws(
    () =>
      assertReviewIdentityMatches(
        expected,
        { ...expected, head_commit: 'c'.repeat(40) },
        'child',
      ),
    /head_commit/u,
  );
});

test('review artifact paths reject traversal and JSON publication is atomic', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-identity-'));
  try {
    assert.throws(
      () =>
        resolveContainedReviewArtifactPath({
          repoRoot,
          relativePath: '../outside.md',
        }),
      /outside codeInfoTmp\/reviews/u,
    );
    const pointerPath = buildReviewArtifactPath({
      repoRoot,
      storyId: '0000013',
      outputKey: 'current-review',
    });
    await atomicWriteJson(pointerPath, { session: 'first' });
    await atomicWriteJson(pointerPath, { session: 'second' });
    assert.deepEqual(JSON.parse(await fs.readFile(pointerPath, 'utf8')), {
      session: 'second',
    });
    assert.deepEqual(
      (await fs.readdir(path.dirname(pointerPath))).filter((name) =>
        name.endsWith('.tmp'),
      ),
      [],
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('failed atomic JSON writes and renames remove their temporary artifacts', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-identity-'));
  const target = path.join(repoRoot, 'review.json');
  try {
    await assert.rejects(
      atomicWriteJson(
        target,
        { state: 'write-failure' },
        {
          mkdir: fs.mkdir,
          writeFile: (async (filePath, data) => {
            await fs.writeFile(filePath, data);
            throw new Error('injected write failure');
          }) as typeof fs.writeFile,
          rename: fs.rename,
        },
      ),
      /injected write failure/u,
    );
    assert.deepEqual(
      (await fs.readdir(repoRoot)).filter((name) => name.endsWith('.tmp')),
      [],
    );

    await assert.rejects(
      atomicWriteJson(
        target,
        { state: 'rename-failure' },
        {
          mkdir: fs.mkdir,
          writeFile: fs.writeFile,
          rename: (async () => {
            throw new Error('injected rename failure');
          }) as typeof fs.rename,
        },
      ),
      /injected rename failure/u,
    );
    assert.deepEqual(
      (await fs.readdir(repoRoot)).filter((name) => name.endsWith('.tmp')),
      [],
    );
    await assert.rejects(fs.readFile(target), /ENOENT/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
