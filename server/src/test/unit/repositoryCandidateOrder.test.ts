import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildRepositoryCandidateOrder,
  DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER,
} from '../../flows/repositoryCandidateOrder.js';

const buildOtherRepo = (sourceId: string, sourceLabel?: string) => ({
  sourceId,
  sourceLabel,
});

test('orders working, owner, codeinfo2, then other repositories in supplied order', () => {
  const result = buildRepositoryCandidateOrder({
    caller: 'flow-command',
    workingRepositoryPath: '/tmp/work-repo',
    ownerRepositoryPath: '/tmp/owner-repo',
    ownerRepositoryLabel: 'Flow Repo',
    codeInfo2Root: '/tmp/codeinfo2',
    otherRepositoryRoots: [
      buildOtherRepo('/tmp/zulu-repo', 'Zulu Repo'),
      buildOtherRepo('/tmp/alpha-repo', 'Alpha Repo'),
    ],
  });

  assert.equal(
    DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER,
    'DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER',
  );
  assert.equal(result.caller, 'flow-command');
  assert.equal(result.workingRepositoryAvailable, true);
  assert.deepEqual(result.candidates, [
    {
      sourceId: path.resolve('/tmp/work-repo'),
      sourceLabel: 'work-repo',
      slot: 'working_repository',
    },
    {
      sourceId: path.resolve('/tmp/owner-repo'),
      sourceLabel: 'Flow Repo',
      slot: 'owner_repository',
    },
    {
      sourceId: path.resolve('/tmp/codeinfo2'),
      sourceLabel: 'codeinfo2',
      slot: 'codeinfo2',
    },
    {
      sourceId: path.resolve('/tmp/zulu-repo'),
      sourceLabel: 'Zulu Repo',
      slot: 'other_repository',
    },
    {
      sourceId: path.resolve('/tmp/alpha-repo'),
      sourceLabel: 'Alpha Repo',
      slot: 'other_repository',
    },
  ]);
});

test('omits the working-repository slot when no working repository is available', () => {
  const result = buildRepositoryCandidateOrder({
    caller: 'markdown',
    ownerRepositoryPath: '/tmp/owner-repo',
    ownerRepositoryLabel: 'Owner Repo',
    codeInfo2Root: '/tmp/codeinfo2',
    otherRepositoryRoots: [buildOtherRepo('/tmp/other-repo', 'Other Repo')],
  });

  assert.equal(result.workingRepositoryAvailable, false);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.slot),
    ['owner_repository', 'codeinfo2', 'other_repository'],
  );
});

test('dedupes a working repository that matches the owner repository', () => {
  const result = buildRepositoryCandidateOrder({
    caller: 'flow-command',
    workingRepositoryPath: '/tmp/Repo-One',
    ownerRepositoryPath: '/tmp/repo-one',
    ownerRepositoryLabel: 'Owner Repo',
    codeInfo2Root: '/tmp/codeinfo2',
    otherRepositoryRoots: [],
  });

  assert.deepEqual(result.candidates, [
    {
      sourceId: path.resolve('/tmp/Repo-One'),
      sourceLabel: 'Repo-One',
      slot: 'working_repository',
    },
    {
      sourceId: path.resolve('/tmp/codeinfo2'),
      sourceLabel: 'codeinfo2',
      slot: 'codeinfo2',
    },
  ]);
});

test('dedupes an owner repository that matches the local codeinfo2 repository', () => {
  const result = buildRepositoryCandidateOrder({
    caller: 'direct-command',
    ownerRepositoryPath: '/tmp/codeinfo2',
    ownerRepositoryLabel: 'Owner Repo',
    codeInfo2Root: '/tmp/CodeInfo2',
    otherRepositoryRoots: [],
  });

  assert.deepEqual(result.candidates, [
    {
      sourceId: path.resolve('/tmp/codeinfo2'),
      sourceLabel: 'Owner Repo',
      slot: 'owner_repository',
    },
  ]);
});

test('starts from scratch for each nested lookup call', () => {
  const firstLookup = buildRepositoryCandidateOrder({
    caller: 'flow-command',
    workingRepositoryPath: '/tmp/work-a',
    ownerRepositoryPath: '/tmp/owner-a',
    ownerRepositoryLabel: 'Owner A',
    codeInfo2Root: '/tmp/codeinfo2',
    otherRepositoryRoots: [buildOtherRepo('/tmp/other-a', 'Other A')],
  });
  const secondLookup = buildRepositoryCandidateOrder({
    caller: 'markdown',
    workingRepositoryPath: '/tmp/work-b',
    ownerRepositoryPath: '/tmp/owner-b',
    ownerRepositoryLabel: 'Owner B',
    codeInfo2Root: '/tmp/codeinfo2',
    otherRepositoryRoots: [
      buildOtherRepo('/tmp/other-b', 'Other B'),
      buildOtherRepo('/tmp/other-c', 'Other C'),
    ],
  });

  assert.deepEqual(
    firstLookup.candidates.map((candidate) => candidate.sourceId),
    [
      path.resolve('/tmp/work-a'),
      path.resolve('/tmp/owner-a'),
      path.resolve('/tmp/codeinfo2'),
      path.resolve('/tmp/other-a'),
    ],
  );
  assert.deepEqual(
    secondLookup.candidates.map((candidate) => candidate.sourceId),
    [
      path.resolve('/tmp/work-b'),
      path.resolve('/tmp/owner-b'),
      path.resolve('/tmp/codeinfo2'),
      path.resolve('/tmp/other-b'),
      path.resolve('/tmp/other-c'),
    ],
  );
});
