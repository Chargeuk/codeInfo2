import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { readPreparedReviewBase } from './reviewBase.js';
import { resolveReviewRepositoryRoot } from './reviewBase.js';
import type { FlowJsonValue } from './types.js';

const execFile = promisify(execFileCb);

type ReviewTargetInput = {
  target_id: string;
  repo_root: string;
  branch: string;
  head_commit: string;
  story_id: string;
};

const requiredString = (
  source: Record<string, FlowJsonValue>,
  key: keyof ReviewTargetInput,
) => {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Review target input lacks ${key}.`);
  }
  return value.trim();
};

export const parseReviewTargetInput = (
  value: FlowJsonValue,
): ReviewTargetInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Review target input must be an object.');
  }
  return {
    target_id: requiredString(value, 'target_id'),
    repo_root: requiredString(value, 'repo_root'),
    branch: requiredString(value, 'branch'),
    head_commit: requiredString(value, 'head_commit'),
    story_id: requiredString(value, 'story_id'),
  };
};

export async function validateReviewTargetContract(params: {
  workingRepositoryPath: string;
  target: FlowJsonValue;
  signal?: AbortSignal;
}) {
  const target = parseReviewTargetInput(params.target);
  const repoRoot = await resolveReviewRepositoryRoot(
    params.workingRepositoryPath,
    undefined,
    params.signal,
  );
  const realWorkingRoot = await fs.realpath(repoRoot);
  const realTargetRoot = await fs.realpath(target.repo_root);
  if (realWorkingRoot !== realTargetRoot) {
    throw new Error(
      `Bound review target ${target.target_id} does not match the working repository.`,
    );
  }
  const git = async (args: string[]) =>
    (
      await execFile('git', args, {
        cwd: realWorkingRoot,
        encoding: 'utf8',
        signal: params.signal,
      })
    ).stdout.trim();
  const [branch, headCommit] = await Promise.all([
    git(['branch', '--show-current']),
    git(['rev-parse', 'HEAD^{commit}']),
  ]);
  if (branch !== target.branch || headCommit !== target.head_commit) {
    throw new Error(
      `Bound review target ${target.target_id} drifted from ${target.branch}@${target.head_commit}.`,
    );
  }
  const prepared = await readPreparedReviewBase({
    workingRepositoryPath: realWorkingRoot,
    storyNumber: target.story_id,
    outputKey: 'current-review-base',
  });
  if (!prepared) {
    throw new Error(
      `Bound review target ${target.target_id} lacks a prepared base.`,
    );
  }
  const base = prepared.artifact;
  if (
    path.resolve(base.repo_root) !== realWorkingRoot ||
    base.target_id !== target.target_id ||
    base.story_id !== target.story_id ||
    base.branch !== target.branch ||
    base.head_commit !== target.head_commit
  ) {
    throw new Error(
      `Prepared review base does not match bound target ${target.target_id}.`,
    );
  }
  return { target, preparedBase: base };
}
