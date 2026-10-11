import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';

import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const execFile = promisify(execFileCallback);
const harnessRoot = path.resolve(process.cwd(), '..');
const timeout = resolveConfiguredTestTimeoutMs(60_000);
const environment = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Retrospective regression',
  GIT_AUTHOR_EMAIL: 'retrospective@example.invalid',
  GIT_COMMITTER_NAME: 'Retrospective regression',
  GIT_COMMITTER_EMAIL: 'retrospective@example.invalid',
  PYTHONDONTWRITEBYTECODE: '1',
};

const git = async (cwd: string, ...args: string[]) =>
  (
    await execFile('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      env: environment,
      timeout,
    })
  ).stdout.trim();

const helper = async <T>(cwd: string, script: string, ...args: string[]) =>
  JSON.parse(
    (
      await execFile(
        'python3',
        [path.join(harnessRoot, 'scripts', script), ...args],
        {
          cwd,
          env: environment,
          timeout,
        },
      )
    ).stdout,
  ) as T;

type Allocation = {
  current_branch: string;
  number: string;
  namespace: string;
  reuse_current_branch: boolean;
  remote_verified: boolean;
  warnings: string[];
};
const allocate = (cwd: string, ownedPlan?: string) =>
  helper<Allocation>(
    cwd,
    'select_retrospective_story_number.py',
    ...(ownedPlan ? ['--owned-plan', ownedPlan] : []),
  );

type ArchiveReceipt = {
  branch: string;
  initial_head_commit: string;
  status: string;
  entries: Array<{
    source_path: string;
    archive_path: string;
    content_sha256: string;
    status: string;
  }>;
};
const archive = (cwd: string) =>
  helper<ArchiveReceipt>(cwd, 'archive_retrospective_story.py');

type TaskHandoffStatus = {
  has_valid_current_task_handoff: boolean;
  reason: string;
};

const fixture = async (t: TestContext) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'retrospective-flow-git-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'origin.git');
  const peer = path.join(root, 'peer');
  await fs.mkdir(repo);
  await git(root, 'init', '--bare', remote);
  await git(repo, 'init', '-b', 'develop');
  await fs.writeFile(path.join(repo, '.gitignore'), 'codeInfoStatus/\n');
  await fs.writeFile(path.join(repo, 'base.txt'), 'develop baseline\n');
  await git(repo, 'add', '.gitignore', 'base.txt');
  await git(repo, 'commit', '-m', 'develop baseline');
  const base = await git(repo, 'rev-parse', 'HEAD');
  await git(repo, 'remote', 'add', 'origin', remote);
  await git(repo, 'push', '-u', 'origin', 'develop');
  await git(
    root,
    '--git-dir',
    remote,
    'symbolic-ref',
    'HEAD',
    'refs/heads/develop',
  );
  await git(root, 'clone', remote, peer);
  await fs.mkdir(path.join(repo, 'planning'));
  return { root, repo, remote, peer, base };
};

const implementationCommit = async (repo: string) => {
  await fs.writeFile(
    path.join(repo, 'implementation.txt'),
    'original delivered work\n',
  );
  await git(repo, 'add', 'implementation.txt');
  await git(repo, 'commit', '-m', 'original story implementation');
  return git(repo, 'rev-parse', 'HEAD');
};

// These are real Git and unchanged-helper proofs. They do not execute an LLM
// flow or implement its collision-repair loop; prompt contracts cover that loop.
test(
  'retrospective allocation detects a live peer number before push without changing either branch',
  { timeout },
  async (t) => {
    const { repo, peer } = await fixture(t);
    const ownBranch = 'feature/0000012-own';
    const peerBranch = 'feature/0000012-peer';
    await git(repo, 'switch', '-c', ownBranch);
    const originalHead = await implementationCommit(repo);
    await git(peer, 'switch', '-c', peerBranch);
    await git(peer, 'push', '-u', 'origin', peerBranch);
    const remoteBefore = await git(repo, 'ls-remote', '--heads', 'origin');
    assert.equal(
      await git(
        repo,
        'show-ref',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${peerBranch}`,
      ).then(
        () => true,
        () => false,
      ),
      false,
    );

    const selection = await allocate(repo);

    assert.equal(selection.number, '0000013');
    assert.equal(selection.reuse_current_branch, false);
    assert.equal(selection.remote_verified, true);
    assert.deepEqual(selection.warnings, []);
    assert.equal(await git(repo, 'branch', '--show-current'), ownBranch);
    assert.equal(await git(repo, 'rev-parse', 'HEAD'), originalHead);
    assert.equal(
      await git(repo, 'ls-remote', '--heads', 'origin'),
      remoteBefore,
    );
  },
);

test(
  'retrospective post-push correction preserves TODO proof and clears obsolete task state before later implementation selects the renamed plan',
  { timeout },
  async (t) => {
    const { repo, peer, base, root, remote } = await fixture(t);
    const ownBranch = 'feature/0000012-own';
    const peerBranch = 'feature/0000012-peer';
    await git(repo, 'switch', '-c', ownBranch);
    const originalHead = await implementationCommit(repo);
    const oldPlan = 'planning/0000012-own.md';
    const newPlan = 'planning/0000013-own.md';
    const plan =
      '# Story 0000012\n\n## Tasks\n\n### Task 1. Delivered implementation\n\n- Task Status: __done__\n\n#### Subtasks\n\n1. [x] Implement behavior.\n\n### Task 2. Final validation\n\n- Task Status: __to_do__\n\n#### Testing\n\n1. [ ] Run the relevant full suite.\n';
    const stateDirectory = path.join(repo, 'codeInfoStatus', 'flow-state');
    await fs.mkdir(stateDirectory, { recursive: true });
    const handoff = path.join(stateDirectory, 'current-plan.json');
    const currentTaskPath = path.join(stateDirectory, 'current-task.json');
    const priorCycleDirectory = path.join(
      stateDirectory,
      'review-cycles',
      'fixture-prior-cycle',
    );

    // Earlier implementation stage: create a genuine existing task handoff with
    // the unchanged selector before constructing the documentation fixture.
    await fs.mkdir(priorCycleDirectory, { recursive: true });
    await fs.writeFile(path.join(repo, oldPlan), plan);
    await fs.writeFile(
      handoff,
      JSON.stringify({ plan_path: oldPlan, branched_from: 'develop' }),
    );
    const earlierSelection = await helper<{
      plan_path: string;
      selected_task: { number: number; status: string };
    }>(repo, 'select_current_task.py');
    assert.equal(earlierSelection.plan_path, oldPlan);
    assert.equal(earlierSelection.selected_task.status, '__in_progress__');
    const oldTaskBytes = await fs.readFile(currentTaskPath);

    // Documentation stage: the replacement story is deliberately open. Do not
    // run the selector again until documentation has been committed and pushed.
    await fs.writeFile(path.join(repo, oldPlan), plan);
    assert.equal(await fs.readFile(path.join(repo, oldPlan), 'utf8'), plan);
    const metadata = {
      plan_path: oldPlan,
      branched_from: 'develop',
      initial_head_commit: originalHead,
      comparison_base_commit: base,
      additional_repositories: [],
      retrospective_archive: { initial_head_commit: originalHead, entries: [] },
    };
    await fs.writeFile(handoff, JSON.stringify(metadata));
    const unrelatedStatePath = path.join(
      stateDirectory,
      'unrelated-state.json',
    );
    const unrelatedStateBytes = Buffer.from(
      'unrelated state stays untouched\n',
    );
    await fs.writeFile(unrelatedStatePath, unrelatedStateBytes);
    // Final collision repair can move a plan already committed on the published
    // branch. Its old path must be removed from the replacement commit as well.
    await git(repo, 'add', '--', oldPlan);
    await git(repo, 'commit', '-m', 'record initial retrospective plan');
    const publishedHead = await git(repo, 'rev-parse', 'HEAD');
    await git(repo, 'push', '-u', 'origin', 'HEAD');
    assert.equal(
      await git(
        repo,
        'ls-remote',
        '--heads',
        'origin',
        `refs/heads/${ownBranch}`,
      ),
      `${publishedHead}\trefs/heads/${ownBranch}`,
    );
    assert.equal((await allocate(repo, oldPlan)).reuse_current_branch, true);

    // A separate checkout publishes another name with our number after our push.
    await git(peer, 'switch', '-c', peerBranch);
    await git(peer, 'push', '-u', 'origin', peerBranch);
    const remoteBefore = await git(repo, 'ls-remote', '--heads', 'origin');
    const selection = await allocate(repo, oldPlan);
    assert.equal(selection.number, '0000013');
    assert.equal(selection.reuse_current_branch, false);
    assert.equal(selection.remote_verified, true);
    assert.equal(
      await git(repo, 'ls-remote', '--heads', 'origin'),
      remoteBefore,
    );

    await fs.writeFile(
      path.join(repo, 'unrelated.txt'),
      'unrelated staged work\n',
    );
    await git(repo, 'add', '--', 'unrelated.txt');
    await git(repo, 'switch', '-c', `feature/${selection.number}-own`, 'HEAD');
    await fs.rename(path.join(repo, oldPlan), path.join(repo, newPlan));
    await fs.writeFile(
      path.join(repo, newPlan),
      (await fs.readFile(path.join(repo, newPlan), 'utf8')).replace(
        '# Story 0000012',
        '# Story 0000013',
      ),
    );
    await fs.writeFile(
      handoff,
      JSON.stringify({ ...metadata, plan_path: newPlan }),
    );
    const stale = await helper<TaskHandoffStatus>(
      repo,
      'check_current_task_handoff.py',
    );
    assert.equal(stale.has_valid_current_task_handoff, false);
    assert.equal(stale.reason, 'plan_path_mismatch');
    // The fixture established this prior archive location. Verify the obsolete
    // task's identity and bytes before preserving it without overwrite/clearing.
    assert.equal(JSON.parse(oldTaskBytes.toString('utf8')).plan_path, oldPlan);
    assert.deepEqual(await fs.readFile(currentTaskPath), oldTaskBytes);
    const preservedTaskPath = path.join(
      priorCycleDirectory,
      'current-task.json',
    );
    await fs.writeFile(preservedTaskPath, oldTaskBytes, { flag: 'wx' });
    assert.deepEqual(await fs.readFile(preservedTaskPath), oldTaskBytes);
    await fs.unlink(currentTaskPath);
    const absentTask = await helper<TaskHandoffStatus>(
      repo,
      'check_current_task_handoff.py',
    );
    assert.equal(absentTask.has_valid_current_task_handoff, false);
    assert.equal(absentTask.reason, 'missing_or_invalid_current_task_handoff');
    assert.equal(
      await fs.stat(currentTaskPath).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.deepEqual(
      await fs.readFile(unrelatedStatePath),
      unrelatedStateBytes,
    );
    const documentedPlan = plan.replace('# Story 0000012', '# Story 0000013');
    assert.equal(
      await fs.readFile(path.join(repo, newPlan), 'utf8'),
      documentedPlan,
    );
    assert.equal(
      await fs.stat(path.join(repo, oldPlan)).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(handoff, 'utf8')), {
      ...metadata,
      plan_path: newPlan,
    });
    assert.equal(await git(repo, 'rev-parse', 'HEAD'), publishedHead);
    assert.equal(await git(repo, 'rev-parse', ownBranch), publishedHead);
    await git(repo, 'merge-base', '--is-ancestor', originalHead, 'HEAD');
    assert.equal(
      await git(repo, 'diff', '--name-only', base, originalHead),
      'implementation.txt',
    );

    assert.equal(await git(repo, 'ls-files', '--', oldPlan), oldPlan);
    await git(repo, 'add', '-A', '--', oldPlan, newPlan);
    await git(
      repo,
      'commit',
      '--only',
      '-m',
      'record corrected retrospective identity',
      '--',
      oldPlan,
      newPlan,
    );
    const finalHead = await git(repo, 'rev-parse', 'HEAD');
    assert.equal(
      await git(repo, 'ls-tree', '-r', '--name-only', 'HEAD', '--', oldPlan),
      '',
    );
    assert.equal(
      await git(repo, 'ls-tree', '-r', '--name-only', 'HEAD', '--', newPlan),
      newPlan,
    );
    assert.equal(
      await git(
        repo,
        'ls-tree',
        '-r',
        '--name-only',
        'HEAD',
        '--',
        'unrelated.txt',
      ),
      '',
    );
    assert.equal(
      await git(repo, 'diff', '--cached', '--name-only'),
      'unrelated.txt',
    );
    assert.equal(
      await git(repo, 'show', `HEAD:implementation.txt`),
      'original delivered work',
    );
    await git(repo, 'push', '-u', 'origin', 'HEAD');
    const finalSelection = await allocate(repo, newPlan);
    assert.equal(finalSelection.number, '0000013');
    assert.equal(finalSelection.reuse_current_branch, true);
    assert.equal(finalSelection.remote_verified, true);
    assert.equal(
      await git(
        repo,
        'ls-remote',
        '--heads',
        'origin',
        'refs/heads/feature/0000013-own',
      ),
      `${finalHead}\trefs/heads/feature/0000013-own`,
    );
    assert.equal(
      await git(
        repo,
        'ls-remote',
        '--heads',
        'origin',
        `refs/heads/${ownBranch}`,
      ),
      `${publishedHead}\trefs/heads/${ownBranch}`,
    );
    assert.equal(
      await git(
        repo,
        'ls-remote',
        '--heads',
        'origin',
        `refs/heads/${peerBranch}`,
      ),
      `${base}\trefs/heads/${peerBranch}`,
    );
    assert.equal(await git(repo, 'ls-files', 'codeInfoStatus'), '');
    const remotePlan = await git(
      root,
      '--git-dir',
      remote,
      'show',
      `${finalHead}:${newPlan}`,
    );
    assert.equal(remotePlan, documentedPlan.trim());
    assert.match(
      remotePlan,
      /Task 2\. Final validation.*Task Status: __to_do__.*1\. \[ \] Run the relevant full suite/su,
    );
    assert.equal(
      await fs.stat(currentTaskPath).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.deepEqual(await fs.readFile(preservedTaskPath), oldTaskBytes);
    assert.deepEqual(
      await fs.readFile(unrelatedStatePath),
      unrelatedStateBytes,
    );

    // Later implementation stage, after the documentation commit and exact
    // remote HEAD verification: only now may the unchanged selector promote TODO
    // and generate a current task for the renamed active plan.
    const laterSelection = await helper<{
      plan_path: string;
      selected_task: { number: number; status: string };
    }>(repo, 'select_current_task.py');
    assert.equal(laterSelection.plan_path, newPlan);
    assert.equal(laterSelection.selected_task.number, 2);
    assert.equal(laterSelection.selected_task.status, '__in_progress__');
    assert.deepEqual(
      JSON.parse(await fs.readFile(currentTaskPath, 'utf8')),
      laterSelection,
    );
    const laterChecked = await helper<TaskHandoffStatus>(
      repo,
      'check_current_task_handoff.py',
    );
    assert.equal(laterChecked.has_valid_current_task_handoff, true);
    assert.equal(laterChecked.reason, 'valid_resolved_current_task_handoff');
    assert.equal(
      await fs.readFile(path.join(repo, newPlan), 'utf8'),
      documentedPlan.replace('__to_do__', '__in_progress__'),
    );
    assert.deepEqual(JSON.parse(await fs.readFile(handoff, 'utf8')), {
      ...metadata,
      plan_path: newPlan,
    });
    assert.equal(
      await git(root, '--git-dir', remote, 'show', `${finalHead}:${newPlan}`),
      remotePlan,
    );
    assert.deepEqual(await fs.readFile(preservedTaskPath), oldTaskBytes);
    assert.deepEqual(
      await fs.readFile(unrelatedStatePath),
      unrelatedStateBytes,
    );
    assert.equal(
      await git(repo, 'diff', '--cached', '--name-only'),
      'unrelated.txt',
    );
  },
);

test(
  'retrospective exact same remote branch is reusable and the retained initial HEAD merge-base excludes divergent develop and later plan commits',
  { timeout },
  async (t) => {
    const { repo, peer, base } = await fixture(t);
    await git(repo, 'switch', '-c', 'feature/0000012-own');
    const originalHead = await implementationCommit(repo);
    const ownedPlan = 'planning/0000012-own.md';
    await fs.writeFile(path.join(repo, ownedPlan), 'retrospective plan\n');
    await git(repo, 'push', '-u', 'origin', 'HEAD');
    const reused = await allocate(repo, ownedPlan);
    assert.equal(reused.number, '0000012');
    assert.equal(reused.reuse_current_branch, true);
    assert.equal(reused.remote_verified, true);

    // Advance the real remote develop after the working checkout cached it.
    await fs.writeFile(
      path.join(peer, 'later-develop.txt'),
      'new remote baseline\n',
    );
    await git(peer, 'add', 'later-develop.txt');
    await git(peer, 'commit', '-m', 'advance develop');
    const freshBase = await git(peer, 'rev-parse', 'HEAD');
    await git(peer, 'push', 'origin', 'develop');
    assert.notEqual(await git(repo, 'rev-parse', 'origin/develop'), freshBase);
    await git(repo, 'fetch', 'origin', 'develop');
    assert.equal(await git(repo, 'rev-parse', 'origin/develop'), freshBase);
    assert.notEqual(freshBase, originalHead);
    const mergeBase = await git(repo, 'merge-base', freshBase, originalHead);
    assert.equal(mergeBase, base);
    assert.equal(
      await git(repo, 'diff', '--name-only', mergeBase, originalHead),
      'implementation.txt',
    );
    // A direct develop-tip diff would wrongly attribute develop-only work as a
    // deletion. The merge-base range describes only the original story work.
    assert.equal(
      await git(
        repo,
        'diff',
        '--diff-filter=D',
        '--name-only',
        freshBase,
        originalHead,
      ),
      'later-develop.txt',
    );
    await git(repo, 'switch', '-c', 'feature/0000013-replacement', 'HEAD');
    assert.equal(await git(repo, 'rev-parse', 'HEAD'), originalHead);
    assert.equal(
      await git(repo, 'log', '--format=%H', 'origin/develop..HEAD'),
      originalHead,
    );
    assert.equal(
      await git(repo, 'diff', '--name-only', 'origin/develop...HEAD'),
      'implementation.txt',
    );
    await git(repo, 'add', '--', ownedPlan);
    await git(repo, 'commit', '-m', 'administrative retrospective plan');
    assert.notEqual(await git(repo, 'rev-parse', 'HEAD'), originalHead);
    assert.equal(
      await git(repo, 'merge-base', freshBase, originalHead),
      mergeBase,
    );
    assert.equal(
      await git(repo, 'diff', '--name-only', mergeBase, originalHead),
      'implementation.txt',
    );
    assert.equal(
      await git(repo, 'show', `${originalHead}:implementation.txt`),
      'original delivered work',
    );
  },
);

test(
  'retrospective archive helper preserves all original bytes and receipt mappings through retries and a handoff identity change',
  { timeout },
  async (t) => {
    const { repo } = await fixture(t);
    await git(repo, 'switch', '-c', 'feature/0000012-own');
    await fs.writeFile(
      path.join(repo, 'planning/0000012-original.md'),
      'committed original proposal\n',
    );
    await git(repo, 'add', '--', 'planning/0000012-original.md');
    await git(
      repo,
      'commit',
      '-m',
      'record original proposal before implementation',
    );
    const originalHead = await implementationCommit(repo);
    const originals = new Map([
      [
        'planning/0000012-original.md',
        Buffer.from(
          '# Original story\r\n\r\n## Acceptance Criteria\r\n- Delivered behavior.\r\n- Explicit remaining requirement: preserve caf\u00e9 input.\r\n\r\n## Decisions\r\nSuperseded approach remains historical.\r\n\r\n## Tasks\r\n- [ ] Unproved future work.\r\n',
        ),
      ],
      [
        'planning/0000012-other.md',
        Buffer.from(
          '# Additional original\n\n## Testing\n- Evidence unavailable; never a claimed pass.\n',
        ),
      ],
    ]);
    for (const [source, bytes] of originals)
      await fs.writeFile(path.join(repo, source), bytes);
    await fs.writeFile(
      path.join(repo, 'planning/0000011-unrelated.md'),
      'unrelated story\n',
    );
    const occupied = path.join(
      repo,
      'planning/one-shot/one-shot-0000012-original.md',
    );
    await fs.mkdir(path.dirname(occupied));
    await fs.writeFile(occupied, 'prior archive stays intact\n');

    const receipt = await archive(repo);
    assert.equal(receipt.status, 'archived');
    assert.equal(receipt.branch, 'feature/0000012-own');
    assert.equal(receipt.initial_head_commit, originalHead);
    assert.equal(receipt.entries.length, originals.size);
    assert.equal(
      new Set(receipt.entries.map((entry) => entry.source_path)).size,
      originals.size,
    );
    assert.equal(
      await git(repo, 'show', `${originalHead}:planning/0000012-original.md`),
      'committed original proposal',
    );
    for (const entry of receipt.entries) {
      const original = originals.get(entry.source_path);
      assert.ok(original, entry.source_path);
      assert.equal(entry.status, 'archived');
      assert.deepEqual(
        await fs.readFile(path.join(repo, entry.archive_path)),
        original,
      );
      assert.equal(
        entry.content_sha256,
        createHash('sha256').update(original).digest('hex'),
      );
      assert.equal(
        await fs.stat(path.join(repo, entry.source_path)).then(
          () => true,
          () => false,
        ),
        false,
      );
    }
    assert.equal(
      await fs.readFile(occupied, 'utf8'),
      'prior archive stays intact\n',
    );
    assert.equal(
      await fs.readFile(
        path.join(repo, 'planning/0000011-unrelated.md'),
        'utf8',
      ),
      'unrelated story\n',
    );
    assert.deepEqual(await archive(repo), receipt);
    const receiptPath = path.join(
      repo,
      'codeInfoStatus/flow-state/retrospective-archive.json',
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(receiptPath, 'utf8')),
      receipt,
    );

    // Exercise preservation of the entire helper result, not a single mapping.
    const handoff = path.join(
      repo,
      'codeInfoStatus/flow-state/current-plan.json',
    );
    await fs.writeFile(
      handoff,
      JSON.stringify({
        plan_path: 'planning/0000012-own.md',
        branched_from: 'develop',
        retrospective_archive: receipt,
      }),
    );
    const current = JSON.parse(await fs.readFile(handoff, 'utf8'));
    await git(repo, 'switch', '-c', 'feature/0000013-own', 'HEAD');
    await fs.writeFile(
      handoff,
      JSON.stringify({ ...current, plan_path: 'planning/0000013-own.md' }),
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(handoff, 'utf8')).retrospective_archive,
      receipt,
    );
    assert.equal(await git(repo, 'rev-parse', 'HEAD'), originalHead);
  },
);

test(
  'retrospective unavailable remote reports unverified allocation and failed fresh fetch even when a cached develop ref exists',
  { timeout },
  async (t) => {
    const { repo, root } = await fixture(t);
    await git(repo, 'switch', '-c', 'feature/0000012-own');
    const cachedDevelop = await git(repo, 'rev-parse', 'origin/develop');
    await git(
      repo,
      'update-ref',
      'refs/remotes/origin/feature/0000012-peer',
      'HEAD',
    );
    await git(
      repo,
      'remote',
      'set-url',
      'origin',
      path.join(root, 'unavailable.git'),
    );

    const selection = await allocate(repo);
    assert.equal(selection.number, '0000013');
    assert.equal(selection.reuse_current_branch, false);
    assert.equal(selection.remote_verified, false);
    assert.ok(
      selection.warnings.some((warning) =>
        /unavailable.*cached origin refs/iu.test(warning),
      ),
    );
    await assert.rejects(
      git(repo, 'fetch', 'origin', 'develop'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as Error & { code: number }).code, 128);
        return true;
      },
    );
    assert.equal(await git(repo, 'rev-parse', 'origin/develop'), cachedDevelop);
    // A cached SHA remains resolvable after failure. It is not proof of a fresh
    // base; the retrospective prompt must record null and the evidence limit.
  },
);
