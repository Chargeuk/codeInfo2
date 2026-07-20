import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { __resetProviderBootstrapStatusForTests } from '../../config/runtimeConfig.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import { startFlowRun } from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';

const execFile = promisify(execFileCb);
const storyId = '0000064';
const planPath = 'planning/0000064-production-review.md';

type JsonObject = Record<string, unknown>;

const readJson = async (filePath: string): Promise<JsonObject> =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as JsonObject;

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const waitForCompletion = async (conversationId: string) => {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const terminal = (memoryTurns.get(conversationId) ?? []).find(
      (turn) =>
        turn.role === 'assistant' &&
        ['ok', 'failed', 'stopped'].includes(turn.status) &&
        turn.command?.stepIndex === turn.command?.totalSteps,
    );
    if (terminal) {
      assert.equal(
        terminal.status,
        'ok',
        JSON.stringify(memoryTurns.get(conversationId) ?? [], null, 2),
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for production review fixture flow. ${JSON.stringify(memoryTurns.get(conversationId) ?? [], null, 2)}`,
  );
};

class ReviewFixtureChat extends ChatInterface {
  constructor(
    private readonly handle: (
      message: string,
      flags: Record<string, unknown>,
    ) => Promise<void>,
  ) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    try {
      await this.handle(message, flags);
      this.emit('final', { type: 'final', content: 'fixture step completed' });
      this.emit('complete', { type: 'complete', threadId: conversationId });
    } catch (error) {
      this.emit('error', {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const writeFlow = async (flowRoot: string, name: string, steps: unknown[]) => {
  await writeJson(path.join(flowRoot, `${name}.json`), {
    description: name,
    steps,
  });
};

const llm = (content: string) => ({
  type: 'llm',
  agentType: 'planning_agent',
  identifier: 'planner',
  messages: [{ role: 'user', content: [content] }],
});

const repoEntry = (
  repoRoot: string,
  id = 'production-review-fixture',
): RepoEntry => ({
  id,
  description: null,
  containerPath: repoRoot,
  hostPath: repoRoot,
  lastIngestAt: '2026-07-14T00:00:00.000Z',
  embeddingProvider: 'lmstudio',
  embeddingModel: 'model',
  embeddingDimensions: 768,
  model: 'model',
  modelId: 'model',
  lock: {
    embeddingProvider: 'lmstudio',
    embeddingModel: 'model',
    embeddingDimensions: 768,
    lockedModelId: 'model',
    modelId: 'model',
  },
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

const initializeRepository = async (
  repoRoot: string,
  additionalRepositories: string[] = [],
) => {
  await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await execFile('git', ['init', '-b', 'main'], { cwd: repoRoot });
  await execFile('git', ['config', 'user.email', 'review@example.com'], {
    cwd: repoRoot,
  });
  await execFile('git', ['config', 'user.name', 'Review Fixture'], {
    cwd: repoRoot,
  });
  await fs.writeFile(
    path.join(repoRoot, '.gitignore'),
    'codeInfoTmp/\ncodeInfoStatus/\n',
  );
  await fs.writeFile(
    path.join(repoRoot, planPath),
    [
      '# Story 64',
      '',
      '## Description',
      '',
      'Prove the production review loop.',
      '',
      '## Acceptance Criteria',
      '',
      '- Validated decisions reach the plan.',
      '',
      '## Out Of Scope',
      '',
      '- Planning files are not review evidence.',
      '',
    ].join('\n'),
  );
  await execFile('git', ['add', '.'], { cwd: repoRoot });
  await execFile('git', ['commit', '-m', 'initial review fixture'], {
    cwd: repoRoot,
  });
  await execFile(
    'git',
    ['checkout', '-b', 'feature/0000064-production-review'],
    { cwd: repoRoot },
  );
  await fs.writeFile(
    path.join(repoRoot, 'app.ts'),
    'export const value = 64;\n',
  );
  await execFile('git', ['add', 'app.ts'], { cwd: repoRoot });
  await execFile('git', ['commit', '-m', 'add reviewed change'], {
    cwd: repoRoot,
  });
  await writeJson(
    path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    {
      plan_path: planPath,
      branched_from: 'main',
      additional_repositories: additionalRepositories.map((repoRoot) => ({
        path: repoRoot,
      })),
    },
  );
};

const installFakeOcr = async (root: string) => {
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const executable = path.join(bin, 'ocr');
  await fs.writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const output = value('--output');
const repo = value('--repo');
if (args[0] === 'agent' && args[1] === 'prepare') {
  fs.copyFileSync(path.join(repo, 'codeInfoTmp', 'reviews', 'ocr-manifest.json'), output);
} else if (args[0] === 'agent' && args[1] === 'validate-comments') {
  const comments = JSON.parse(fs.readFileSync(value('--comments'), 'utf8'));
  fs.writeFileSync(output, JSON.stringify({schema_version:'codex-review-validation/v1',bundle_id:comments.bundle_id,valid:true,errors:[],warnings:[]}));
} else if (args[0] === 'agent' && args[1] === 'report') {
  fs.writeFileSync(output, '# OCR report\\n');
} else {
  process.exitCode = 2;
}
`,
  );
  await fs.chmod(executable, 0o755);
  return bin;
};

const reviewDirFor = (repoRoot: string) =>
  path.join(repoRoot, 'codeInfoTmp', 'reviews');

const publishMain = async (repoRoot: string) => {
  const reviewDir = reviewDirFor(repoRoot);
  const base = await readJson(
    path.join(reviewDir, `${storyId}-current-review-base.json`),
  );
  await fs.writeFile(path.join(reviewDir, 'evidence.md'), '# Evidence\n');
  await writeJson(path.join(reviewDir, 'findings.json'), {
    findings: [
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `finding-accepted-${index}`,
        title: `Guard the validated decision join ${index}`,
        severity: 'should_fix',
        path: 'app.ts',
        line: index + 1,
        detail: 'x'.repeat(20 * 1024),
      })),
    ],
  });
  const repository = {
    repo_alias: base.repo_alias,
    repo_root: base.repo_root,
    branch: base.branch,
    logical_base_branch: base.logical_base_branch,
    resolved_base_branch: base.resolved_base_branch,
    resolved_base_source: base.resolved_base_source,
    remote_name: base.remote_name,
    remote_fetch_status: base.remote_fetch_status,
    local_fallback_reason: base.local_fallback_reason,
    comparison_base_ref: base.comparison_base_ref,
    comparison_base_commit: base.comparison_base_commit,
    comparison_head_ref: base.comparison_head_ref,
    comparison_rule: base.comparison_rule,
    head_commit: base.head_commit,
  };
  await writeJson(path.join(reviewDir, `${storyId}-current-review.json`), {
    ...base,
    evidence_file: 'codeInfoTmp/reviews/evidence.md',
    findings_file: 'codeInfoTmp/reviews/findings.json',
    repos: [repository],
    status: 'completed',
  });
};

const publishCodex = async (repoRoot: string) => {
  const reviewDir = reviewDirFor(repoRoot);
  const base = await readJson(
    path.join(reviewDir, `${storyId}-current-review-base.json`),
  );
  await fs.writeFile(path.join(reviewDir, 'codex.md'), '# Codex review\n');
  await writeJson(
    path.join(reviewDir, `${storyId}-current-codex-review.json`),
    {
      ...base,
      canonical_review_pass_id: base.review_pass_id,
      codex_review_pass_id: `${String(base.review_pass_id)}-codex`,
      review_output_file: 'codeInfoTmp/reviews/codex.md',
      findings: [
        {
          id: 'finding-ignored',
          title: 'Unrelated naming preference',
          severity: 'optional',
          path: 'app.ts',
          line: 1,
        },
      ],
      status: 'completed',
    },
  );
};

const publishOpenCode = async (repoRoot: string) => {
  const reviewDir = reviewDirFor(repoRoot);
  const base = await readJson(
    path.join(reviewDir, `${storyId}-current-review-base.json`),
  );
  const bundleId = `sha256:${'1'.padStart(64, '0')}`;
  await writeJson(path.join(reviewDir, 'ocr-comments.json'), {
    schema_version: 'codex-review-comments/v1',
    bundle_id: bundleId,
    summary: { files_reviewed: 1, issues_found: 0 },
    comments: [],
  });
  await fs.writeFile(path.join(reviewDir, 'ocr-report.md'), '# OCR report\n');
  await writeJson(path.join(reviewDir, 'ocr-validation.json'), {
    schema_version: 'codex-review-validation/v1',
    bundle_id: bundleId,
    valid: true,
    errors: [],
    warnings: [],
  });
  await writeJson(path.join(reviewDir, 'ocr-manifest.json'), {
    schema_version: 'codex-review-manifest/v1',
    manifest_id: `sha256:${'a'.repeat(64)}`,
    root: repoRoot,
    target_hash: `sha256:${'d'.repeat(64)}`,
    batch_strategy: 'diff',
    batch_size: 1,
    partial: false,
    summary: { total_files: 1, reviewable_files: 1, excluded_files: 0 },
    skipped_files: [],
    bundles: [
      {
        schema_version: 'codex-review-bundle/v1',
        bundle_id: bundleId,
        target: {
          mode: 'range',
          from: base.comparison_base_commit,
          to: base.head_commit,
          base_sha: base.comparison_base_commit,
          head_sha: base.head_commit,
          merge_base_sha: base.comparison_base_commit,
          diff_sha256: `sha256:${'d'.repeat(64)}`,
        },
        summary: { total_files: 1, reviewable_files: 1, excluded_files: 0 },
        files: [
          {
            path: 'app.ts',
            reviewable: true,
            patch: '@@ -0,0 +1 @@\n+export const value = 64;',
            hunks: [],
          },
        ],
      },
    ],
  });
  await writeJson(
    path.join(reviewDir, `${storyId}-current-open-code-review.json`),
    {
      ...base,
      schema_version: 'codeinfo-open-code-review/v1',
      canonical_review_pass_id: base.review_pass_id,
      open_code_review_pass_id: `${String(base.review_pass_id)}-ocr`,
      manifest_path: 'codeInfoTmp/reviews/ocr-manifest.json',
      bundles: [
        {
          bundle_id: bundleId,
          comments_path: 'codeInfoTmp/reviews/ocr-comments.json',
          validation_path: 'codeInfoTmp/reviews/ocr-validation.json',
          report_path: 'codeInfoTmp/reviews/ocr-report.md',
        },
      ],
      coverage: {
        total_files: 1,
        reviewable_files: 1,
        reviewed_files: 1,
        excluded_files: 0,
        skipped_files: 0,
        failed_files: 0,
      },
      review_output_file: 'codeInfoTmp/reviews/ocr-report.md',
      overall_validation_status: 'valid',
      partial: false,
      status: 'completed',
    },
  );
};

const publishCrossRepository = async (repoRoot: string) => {
  const reviewDir = reviewDirFor(repoRoot);
  const snapshot = await readJson(
    path.join(reviewDir, `${storyId}-current-review-targets.json`),
  );
  await writeJson(
    path.join(reviewDir, `${storyId}-current-cross-repository-review.json`),
    {
      schema_version: 'codeinfo-cross-repository-review/v1',
      story_id: storyId,
      review_wave_id: snapshot.review_wave_id,
      parent_execution_id: snapshot.parent_execution_id,
      targets_sha256: snapshot.targets_sha256,
      target_count: (snapshot.targets as JsonObject[]).length,
      inspected_target_ids: (snapshot.targets as JsonObject[]).map((target) =>
        String(target.target_id),
      ),
      relationship_coverage:
        (snapshot.targets as JsonObject[]).length > 1
          ? { 'fixture-target-coverage': 'inspected' }
          : {},
      status:
        (snapshot.targets as JsonObject[]).length > 1
          ? 'completed'
          : 'not_applicable',
      findings: [],
      rejected_risks: [],
      residual_uncertainty: [],
      completed_at: '2026-07-14T12:01:00.000Z',
    },
  );
};

const dispositionPath = (repoRoot: string) =>
  path.join(
    repoRoot,
    'codeInfoStatus',
    'flow-state',
    'review-disposition-state.json',
  );

const classify = async (repoRoot: string) => {
  const reviewDir = reviewDirFor(repoRoot);
  const base = await readJson(
    path.join(reviewDir, `${storyId}-current-review-base.json`),
  );
  const validationPath = path.join(
    reviewDir,
    `${storyId}-current-review-wave-validation.json`,
  );
  try {
    await fs.access(validationPath);
  } catch {
    await writeJson(dispositionPath(repoRoot), {
      story_id: storyId,
      plan_path: planPath,
      review_pass_id: base.review_pass_id,
      review_decision_recording: {
        review_pass_id: base.review_pass_id,
        outcome: 'retry_required',
        accepted_count: 0,
        ignored_count: 0,
        plan_commit_sha: null,
      },
      needs_review_rerun_before_close: true,
      safe_to_exit_review_loop_without_tasking: false,
    });
    return;
  }
  await writeJson(dispositionPath(repoRoot), {
    schema_version: 1,
    story_id: storyId,
    story_number: '64',
    plan_path: planPath,
    review_session_id: base.review_session_id,
    review_pass_id: base.review_pass_id,
    parent_execution_id: base.parent_execution_id,
    head_commit: base.head_commit,
    comparison_base_commit: base.comparison_base_commit,
    review_cycle_id: '64-rc-20260714T200000Z-1234abcd',
    unresolved_task_required_findings: [
      {
        id: 'finding-accepted',
        severity: 'should_fix',
        repository: 'current_repository',
        summary: 'Guard the validated decision join',
        reason: 'The production path must retain validated decisions.',
      },
    ],
    unresolved_minor_batchable_findings: [],
    rejected_or_non_actionable_findings: [
      {
        id: 'finding-ignored',
        repository: 'current_repository',
        summary: 'Unrelated naming preference',
        reason: 'This preference is outside the story behavior.',
      },
    ],
    review_decision_recording: {
      review_pass_id: base.review_pass_id,
      outcome: 'pending',
      accepted_count: 0,
      ignored_count: 0,
      plan_commit_sha: null,
    },
  });
};

const recordDecisions = async (repoRoot: string) => {
  const state = await readJson(dispositionPath(repoRoot));
  const recording = state.review_decision_recording as JsonObject;
  if (recording.outcome === 'retry_required') return;
  const reviewPassId = String(state.review_pass_id);
  const planFile = path.join(repoRoot, planPath);
  let plan = await fs.readFile(planFile, 'utf8');
  const passMarker = `- Review pass: \`${reviewPassId}\``;
  if (!plan.includes(passMarker)) {
    plan += [
      '',
      '## Code Review Findings',
      '',
      passMarker,
      `- Review cycle: \`${String(state.review_cycle_id)}\``,
      `- Comparison context: local \`HEAD\` \`${String(state.head_commit)}\` versus resolved base \`main@${String(state.comparison_base_commit)}\`.`,
      '',
      '### Accepted',
      '',
      '#### 1. Guard the validated decision join',
      '',
      '- Finding ID: `finding-accepted`',
      '- Found by: Codex Review (current_repository), Open Code Review (current_repository)',
      '- Description: The production review join must publish validation before decisions are recorded.',
      '- Example: The accepted fixture finding is owned by `current_repository` in `app.ts`.',
      '- Why accepted: It directly protects durable story-plan recording.',
      '',
      '### Ignored for This Story',
      '',
      '#### 2. Unrelated naming preference',
      '',
      '- Finding ID or Review reference: `finding-ignored`',
      '- Found by: `external-review-note-1`',
      '- Description: A naming preference does not change the reviewed behavior.',
      '- Example: The ignored fixture refers to the exported name in `app.ts`.',
      '- Why ignored: It is outside the story behavior.',
      '',
    ].join('\n');
    await fs.writeFile(planFile, plan);
    await execFile('git', ['add', '--', planPath], { cwd: repoRoot });
    await execFile(
      'git',
      [
        'commit',
        '-m',
        'DEV-[64] - record production review fixture',
        '-m',
        'Records accepted and ignored review decisions for the active pass. The fixture proves the production validation join reaches the story plan. It commits only the canonical plan. The transient disposition state remains untracked.',
      ],
      { cwd: repoRoot },
    );
  }
  const commit = (
    await execFile('git', ['log', '-1', '--format=%H', '--', planPath], {
      cwd: repoRoot,
    })
  ).stdout.trim();
  await writeJson(dispositionPath(repoRoot), {
    ...state,
    review_decision_recording: {
      review_pass_id: reviewPassId,
      outcome: 'recorded',
      accepted_count: 1,
      ignored_count: 1,
      plan_commit_sha: commit,
    },
  });
};

const writeProductionFixtureFlows = async (
  flowRoot: string,
  removeValidation: boolean,
) => {
  await Promise.all([
    writeFlow(flowRoot, 'review_artifacts_main', [llm('fixture publish main')]),
    writeFlow(flowRoot, 'codex_review', [llm('fixture publish codex')]),
    writeFlow(flowRoot, 'open_code_review', [llm('fixture publish open code')]),
    writeFlow(flowRoot, 'cross_repository_review', [
      llm('fixture publish cross repository'),
    ]),
  ]);
  await writeFlow(flowRoot, 'production-review-loop', [
    { type: 'prepareReviewTargets', outputKey: 'review_wave' },
    {
      type: 'prepareReviewSet',
      snapshotFrom: 'review_wave',
      outputKey: 'review_set',
      reviewFlowNames: [
        'review_artifacts_main',
        'codex_review',
        'open_code_review',
      ],
      crossRepositoryFlowName: 'cross_repository_review',
    },
    {
      type: 'subflowWave',
      failureMode: 'best_effort',
      groups: [
        {
          kind: 'matrix',
          id: 'target_reviews',
          itemsFrom: 'review_wave.targets',
          itemName: 'target',
          flowNames: [
            'review_artifacts_main',
            'codex_review',
            'open_code_review',
          ],
          bindings: {
            workingFolderFrom: 'target.repo_root',
            input: {
              target: 'target',
              review_wave: 'review_wave',
              review_set: 'review_set',
            },
          },
        },
        {
          kind: 'singleton',
          id: 'cross_repository_review',
          flowName: 'cross_repository_review',
          bindings: {
            workingFolderFrom: 'review_wave.plan_host_root',
            input: { review_wave: 'review_wave', review_set: 'review_set' },
          },
        },
      ],
    },
    {
      type: 'validateReviewWave',
      snapshotFrom: 'review_wave',
      reviewSetFrom: 'review_set',
    },
    ...(removeValidation ? [llm('fixture remove wave validation')] : []),
    {
      type: 'llm',
      agentType: 'planning_agent',
      identifier: 'planner',
      markdownFile: 'classify_review_disposition.md',
    },
    {
      type: 'llm',
      agentType: 'planning_agent',
      identifier: 'planner',
      continueOnFailure: true,
      markdownFile: 'record_review_issue_decisions_in_plan.md',
    },
  ]);
};

test('production one-target review loop validates four jobs and durably records each pass exactly once', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'production-review-loop-'),
  );
  const repoRoot = path.join(root, 'repo');
  const flowRoot = path.join(root, 'flows');
  const originalPath = process.env.PATH;
  const originalFlowsDir = process.env.FLOWS_DIR;
  installDeterministicCodexAvailabilityBootstrap();
  memoryConversations.clear();
  memoryTurns.clear();
  try {
    await fs.mkdir(flowRoot, { recursive: true });
    await initializeRepository(repoRoot);
    process.env.PATH = `${await installFakeOcr(root)}${path.delimiter}${originalPath ?? ''}`;
    process.env.FLOWS_DIR = flowRoot;
    __setMarkdownFileResolverDepsForTests({
      getCodeInfo2Root: () => path.resolve(process.cwd(), '..'),
      listIngestedRepositories: async () => ({
        repos: [repoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });
    await writeProductionFixtureFlows(flowRoot, false);

    const handler = async (message: string, flags: Record<string, unknown>) => {
      const workingRoot =
        typeof flags.workingDirectoryOverride === 'string'
          ? flags.workingDirectoryOverride
          : repoRoot;
      if (message.includes('fixture publish main'))
        await publishMain(workingRoot);
      else if (message.includes('fixture publish codex'))
        await publishCodex(workingRoot);
      else if (message.includes('fixture publish open code'))
        await publishOpenCode(workingRoot);
      else if (message.includes('fixture publish cross repository'))
        await publishCrossRepository(workingRoot);
      else if (
        message.includes(
          'Classify the current review outcome into a machine-readable flow-state file',
        )
      )
        await classify(repoRoot);
      else if (
        message.includes(
          "Record the current review pass's accepted and ignored issue decisions",
        )
      )
        await recordDecisions(repoRoot);
      else if (message.includes('fixture remove wave validation'))
        await fs.rm(
          path.join(
            reviewDirFor(repoRoot),
            `${storyId}-current-review-wave-validation.json`,
          ),
        );
    };
    const run = async () => {
      const result = await startFlowRun({
        flowName: 'production-review-loop',
        source: 'REST',
        working_folder: repoRoot,
        chatFactory: () => new ReviewFixtureChat(handler),
        listIngestedRepositories: async () => ({
          repos: [repoEntry(repoRoot)],
          lockedModelId: null,
        }),
      });
      await waitForCompletion(result.conversationId);
      return result.conversationId;
    };

    const firstConversationId = await run();
    const firstSnapshot = await readJson(
      path.join(
        reviewDirFor(repoRoot),
        `${storyId}-current-review-targets.json`,
      ),
    );
    const firstBase = await readJson(
      path.join(reviewDirFor(repoRoot), `${storyId}-current-review-base.json`),
    );
    const firstSet = await readJson(
      path.join(reviewDirFor(repoRoot), `${storyId}-current-review-set.json`),
    );
    const firstJobs = firstSet.job_results as JsonObject[];
    assert.equal(firstJobs.length, 4);
    assert.equal(
      (firstSet.aggregated_findings as JsonObject[]).length,
      5,
      'the canonical finalized manifest retains oversized finding detail',
    );
    assert.equal(
      (firstJobs[0]?.validation as JsonObject | undefined)?.validated_findings,
      undefined,
      'wave validation retains metadata while canonical findings own detail',
    );
    const persistedFlowValues = (
      memoryConversations.get(firstConversationId)?.flags as
        | { flow?: { values?: { review_set?: JsonObject } } }
        | undefined
    )?.flow?.values;
    assert.equal(
      persistedFlowValues?.review_set?.job_results,
      undefined,
      'the parent flow retains its compact prepared manifest after validation',
    );
    assert.equal(
      firstJobs
        .filter((job) => job.target_id !== null)
        .every(
          (job) =>
            job.status === 'completed' &&
            (job.validation as JsonObject)?.usable === true,
        ),
      true,
      JSON.stringify(firstJobs, null, 2),
    );
    const mainPointer = await readJson(
      path.join(reviewDirFor(repoRoot), `${storyId}-current-review.json`),
    );
    assert.equal(mainPointer.review_wave_id, firstSnapshot.review_wave_id);
    assert.equal(mainPointer.target_id, 'current_repository');
    const firstState = await readJson(dispositionPath(repoRoot));
    const firstRecording = firstState.review_decision_recording as JsonObject;
    assert.equal(firstRecording.outcome, 'recorded');
    let plan = await fs.readFile(path.join(repoRoot, planPath), 'utf8');
    assert.equal(plan.match(/^## Code Review Findings$/gmu)?.length, 1);
    assert.equal(
      plan.split(`- Review pass: \`${String(firstBase.review_pass_id)}\``)
        .length - 1,
      1,
    );

    await run();
    const secondSnapshot = await readJson(
      path.join(
        reviewDirFor(repoRoot),
        `${storyId}-current-review-targets.json`,
      ),
    );
    const secondBase = await readJson(
      path.join(reviewDirFor(repoRoot), `${storyId}-current-review-base.json`),
    );
    assert.notEqual(
      secondSnapshot.review_wave_id,
      firstSnapshot.review_wave_id,
    );
    assert.notEqual(secondBase.review_pass_id, firstBase.review_pass_id);
    plan = await fs.readFile(path.join(repoRoot, planPath), 'utf8');
    assert.equal(plan.match(/^## Code Review Findings$/gmu)?.length, 2);
    for (const pass of [firstBase.review_pass_id, secondBase.review_pass_id]) {
      assert.equal(
        plan.split(`- Review pass: \`${String(pass)}\``).length - 1,
        1,
      );
    }

    const planBeforeRetry = plan;
    const headBeforeRetry = (
      await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
    ).stdout.trim();
    await writeProductionFixtureFlows(flowRoot, true);
    await run();
    const retryState = await readJson(dispositionPath(repoRoot));
    assert.equal(
      (retryState.review_decision_recording as JsonObject).outcome,
      'retry_required',
    );
    assert.equal(
      await fs.readFile(path.join(repoRoot, planPath), 'utf8'),
      planBeforeRetry,
    );
    assert.equal(
      (
        await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
      ).stdout.trim(),
      headBeforeRetry,
    );
  } finally {
    process.env.PATH = originalPath;
    if (originalFlowsDir === undefined) delete process.env.FLOWS_DIR;
    else process.env.FLOWS_DIR = originalFlowsDir;
    memoryConversations.clear();
    memoryTurns.clear();
    resetDeterministicCodexAvailabilityBootstrap();
    __resetProviderBootstrapStatusForTests();
    __resetMarkdownFileResolverDepsForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('production three-target review loop closes only after every target and cross-repository result is usable', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'production-review-loop-three-target-'),
  );
  const repoRoot = path.join(root, 'repo');
  const additionalRoots = [
    path.join(root, 'additional-one'),
    path.join(root, 'additional-two'),
  ];
  const flowRoot = path.join(root, 'flows');
  const originalPath = process.env.PATH;
  const originalFlowsDir = process.env.FLOWS_DIR;
  installDeterministicCodexAvailabilityBootstrap();
  memoryConversations.clear();
  memoryTurns.clear();
  let decisionRecordedAfterCompleteCoverage = false;
  try {
    await fs.mkdir(flowRoot, { recursive: true });
    await Promise.all(
      additionalRoots.map((root) => initializeRepository(root)),
    );
    await initializeRepository(repoRoot, additionalRoots);
    process.env.PATH = `${await installFakeOcr(root)}${path.delimiter}${originalPath ?? ''}`;
    process.env.FLOWS_DIR = flowRoot;
    const repositories = [
      repoEntry(repoRoot, 'primary'),
      ...additionalRoots.map((root, index) =>
        repoEntry(root, `additional-${index + 1}`),
      ),
    ];
    __setMarkdownFileResolverDepsForTests({
      getCodeInfo2Root: () => path.resolve(process.cwd(), '..'),
      listIngestedRepositories: async () => ({
        repos: repositories,
        lockedModelId: null,
      }),
    });
    await writeProductionFixtureFlows(flowRoot, false);

    const handler = async (message: string, flags: Record<string, unknown>) => {
      const workingRoot =
        typeof flags.workingDirectoryOverride === 'string'
          ? flags.workingDirectoryOverride
          : repoRoot;
      if (message.includes('fixture publish main'))
        await publishMain(workingRoot);
      else if (message.includes('fixture publish codex'))
        await publishCodex(workingRoot);
      else if (message.includes('fixture publish open code'))
        await publishOpenCode(workingRoot);
      else if (message.includes('fixture publish cross repository'))
        await publishCrossRepository(workingRoot);
      else if (
        message.includes(
          'Classify the current review outcome into a machine-readable flow-state file',
        )
      )
        await classify(repoRoot);
      else if (
        message.includes(
          "Record the current review pass's accepted and ignored issue decisions",
        )
      ) {
        const current = await readJson(
          path.join(
            reviewDirFor(repoRoot),
            `${storyId}-current-review-set.json`,
          ),
        );
        const currentJobs = current.job_results as JsonObject[];
        decisionRecordedAfterCompleteCoverage =
          current.closeout_allowed === true &&
          current.cross_repository_status === 'completed' &&
          currentJobs.every((job) => job.status === 'completed');
        await recordDecisions(repoRoot);
      }
    };
    const result = await startFlowRun({
      flowName: 'production-review-loop',
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () => new ReviewFixtureChat(handler),
      listIngestedRepositories: async () => ({
        repos: repositories,
        lockedModelId: null,
      }),
    });
    await waitForCompletion(result.conversationId);

    const snapshot = await readJson(
      path.join(
        reviewDirFor(repoRoot),
        `${storyId}-current-review-targets.json`,
      ),
    );
    const finalized = await readJson(
      path.join(reviewDirFor(repoRoot), `${storyId}-current-review-set.json`),
    );
    const jobs = finalized.job_results as JsonObject[];
    assert.equal((snapshot.targets as JsonObject[]).length, 3);
    assert.equal(jobs.length, 10);
    assert.equal(jobs.filter((job) => job.target_id !== null).length, 9);
    assert.equal(jobs.filter((job) => job.target_id === null).length, 1);
    assert.equal(
      jobs.every((job) => job.status === 'completed'),
      true,
      JSON.stringify(jobs, null, 2),
    );
    assert.equal(finalized.cross_repository_status, 'completed');
    assert.equal(finalized.closeout_allowed, true);
    assert.equal(finalized.story_id, snapshot.story_id);
    assert.equal(finalized.review_wave_id, snapshot.review_wave_id);
    assert.equal(finalized.parent_execution_id, snapshot.parent_execution_id);
    assert.equal(finalized.targets_sha256, snapshot.targets_sha256);
    for (const job of jobs.filter(
      (candidate) => candidate.target_id !== null,
    )) {
      const target = (snapshot.targets as JsonObject[]).find(
        (candidate) => candidate.target_id === job.target_id,
      );
      assert(target);
      const validation = job.validation as JsonObject;
      assert.equal(validation.story_id, snapshot.story_id);
      assert.equal(
        validation.parent_execution_id,
        snapshot.parent_execution_id,
      );
      assert.equal(validation.review_wave_id, snapshot.review_wave_id);
      assert.equal(validation.target_id, target.target_id);
      assert.equal(validation.head_commit, target.head_commit);
      assert.equal(
        validation.comparison_base_commit,
        target.comparison_base_commit,
      );
      assert.equal(typeof validation.review_session_id, 'string');
      assert.equal(typeof validation.review_pass_id, 'string');
      assert.equal(
        String(job.validation_file).startsWith(String(target.repo_root)),
        true,
      );
    }
    assert.equal(decisionRecordedAfterCompleteCoverage, true);
    assert.equal(
      await readJson(dispositionPath(repoRoot)).then(
        (state) => (state.review_decision_recording as JsonObject).outcome,
      ),
      'recorded',
    );
  } finally {
    process.env.PATH = originalPath;
    if (originalFlowsDir === undefined) delete process.env.FLOWS_DIR;
    else process.env.FLOWS_DIR = originalFlowsDir;
    memoryConversations.clear();
    memoryTurns.clear();
    resetDeterministicCodexAvailabilityBootstrap();
    __resetProviderBootstrapStatusForTests();
    __resetMarkdownFileResolverDepsForTests();
    await fs.rm(root, { recursive: true, force: true });
  }
});
