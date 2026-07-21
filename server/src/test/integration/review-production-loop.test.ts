import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { prepareReviewBatchWorkspace } from '../../flows/reviewBatchWorkspace.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import {
  __resetFlowServiceDepsForTests,
  __setFlowServiceDepsForTests,
  startFlowRun,
} from '../../flows/service.js';
import { expandSubflowWaveJobs } from '../../flows/subflowWave.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

afterEach(() => {
  __resetFlowServiceDepsForTests();
  resetDeterministicCodexAvailabilityBootstrap();
  memoryConversations.clear();
  memoryTurns.clear();
});

const createFixture = async (targetCount: number) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-review-production-'));
  const planPath = 'planning/0000064-generic-review.md';
  await fs.mkdir(path.join(root, 'planning'), { recursive: true });
  await fs.mkdir(path.join(root, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, planPath),
    '# Story 64\n\n## Description\n\nGeneric review batches.\n\n## Acceptance Criteria\n\n- Best effort.\n',
  );
  await fs.writeFile(
    path.join(root, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({ plan_path: planPath }),
  );
  const targets = await Promise.all(
    Array.from({ length: targetCount }, async (_, index) => {
      const repoRoot = index === 0 ? root : path.join(root, `repo-${index}`);
      await fs.mkdir(repoRoot, { recursive: true });
      return {
        target_id: index === 0 ? 'current_repository' : `repo-${index}`,
        repo_alias: index === 0 ? 'current_repository' : `repo-${index}`,
        repo_root: repoRoot,
        repository_id: `repo-${index}`,
        branch: 'feature/0000064-generic-review',
        head_commit: String(index + 1).repeat(40),
        comparison_base_commit: 'a'.repeat(40),
        story_id: '0000064',
        is_primary: index === 0,
      };
    }),
  );
  const snapshot: ReviewTargetSnapshot = {
    schema_version: 'codeinfo-review-targets/v1',
    story_id: '0000064',
    plan_path: planPath,
    branched_from: 'main',
    plan_host_root: root,
    review_cycle_id: '0000064-rc-generic',
    review_wave_id: '0000064-rw-generic',
    targets_sha256: 'f'.repeat(64),
    targets,
    created_at: '2026-07-21T00:00:00.000Z',
  };
  return { root, snapshot };
};

test('production generic batch pre-creates every multi-target reviewer job without an expected-result join', async () => {
  const fixture = await createFixture(3);
  try {
    const jobs = expandSubflowWaveJobs({
      step: { type: 'subflowWave', groupsFrom: 'review_groups' },
      input: {
        targets: fixture.snapshot.targets,
        review_groups: [
          {
            kind: 'matrix',
            id: 'configured',
            itemsFrom: 'targets',
            itemName: 'target',
            flowNames: ['codex_review', 'open_code_review'],
            bindings: { workingFolderFrom: 'target.repo_root' },
          },
          {
            kind: 'singleton',
            id: 'story',
            flowName: 'cross_repository_review',
          },
        ],
      },
    });
    const workspace = await prepareReviewBatchWorkspace({
      snapshot: fixture.snapshot,
      jobs,
    });

    assert.equal(workspace.jobs.length, 7);
    assert.equal(
      (await fs.readdir(path.join(workspace.batchRoot, 'jobs'))).length,
      7,
    );
    for (const job of workspace.jobs) {
      const reviewJob = job.input?.review_job as Record<string, unknown>;
      assert.deepEqual(await fs.readdir(String(reviewJob.output_dir)), []);
    }
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('reviewer regrouping does not change the job workspace or consumer boundary', async () => {
  const fixture = await createFixture(1);
  try {
    const makeJob = (groupId: string) =>
      expandSubflowWaveJobs({
        step: { type: 'subflowWave', groupsFrom: 'review_groups' },
        input: {
          targets: fixture.snapshot.targets,
          review_groups: [
            {
              kind: 'matrix',
              id: groupId,
              itemsFrom: 'targets',
              itemName: 'target',
              flowNames: ['movable_reviewer'],
              bindings: { workingFolderFrom: 'target.repo_root' },
            },
          ],
        },
      })[0];
    const repeated = await prepareReviewBatchWorkspace({
      snapshot: fixture.snapshot,
      jobs: [makeJob('repeated')!],
    });
    const movedSnapshot = {
      ...fixture.snapshot,
      review_wave_id: '0000064-rw-moved',
    };
    const oneShot = await prepareReviewBatchWorkspace({
      snapshot: movedSnapshot,
      jobs: [makeJob('one_shot')!],
    });
    const repeatedContract = repeated.jobs[0]?.input?.review_job as Record<
      string,
      unknown
    >;
    const movedContract = oneShot.jobs[0]?.input?.review_job as Record<
      string,
      unknown
    >;

    assert.deepEqual(Object.keys(repeatedContract), Object.keys(movedContract));
    assert.equal(JSON.stringify(repeatedContract).includes('fast'), false);
    assert.equal(JSON.stringify(movedContract).includes('slow'), false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

type ProductionReviewProbe = {
  repo: string;
  repeatedHeads: string[];
  oneShotHeads: string[];
  directFixCalls: number;
  breakCalls: number;
};

const parseAssignedOutputDirectory = (message: string): string | null => {
  const match = /"output_dir":\s*"([^"]+)"/u.exec(message);
  return match?.[1] ?? null;
};

const currentHead = async (repo: string) =>
  (await execFile('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

class ProductionReviewChat extends ChatInterface {
  constructor(private readonly probe: ProductionReviewProbe) {
    super();
  }

  async execute(
    message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });

    const outputDirectory = parseAssignedOutputDirectory(message);
    if (outputDirectory) {
      await fs.mkdir(outputDirectory, { recursive: true });
      await fs.writeFile(
        path.join(outputDirectory, 'flexible-review-notes.txt'),
        'Self-describing review output; no fixed result schema.\n',
      );
      const head = await currentHead(this.probe.repo);
      if (message.includes('INTEGRATION REPEATED REVIEW')) {
        this.probe.repeatedHeads.push(head);
      }
      if (message.includes('INTEGRATION ONE-SHOT REVIEW')) {
        this.probe.oneShotHeads.push(head);
      }
    }

    if (message.includes('# Implement direct fixes from the current review batch')) {
      this.probe.directFixCalls += 1;
      if (this.probe.directFixCalls === 1) {
        await fs.appendFile(
          path.join(this.probe.repo, 'feature.txt'),
          'review fix\n',
        );
        await execFile('git', ['add', 'feature.txt'], { cwd: this.probe.repo });
        await execFile(
          'git',
          ['commit', '-m', 'DEV-64 - Apply deterministic review fix'],
          { cwd: this.probe.repo },
        );
      }
    }

    if (
      message.includes(
        'Do not use provider pointers, reviewer counts, or conversational memory.',
      )
    ) {
      this.probe.breakCalls += 1;
      const answer = this.probe.breakCalls === 1 ? 'no' : 'yes';
      this.emit('final', {
        type: 'final',
        content: JSON.stringify({ answer }),
      });
      this.emit('complete', { type: 'complete', threadId: conversationId });
      return;
    }

    if (message.includes('# Apply the agent-native review settlement')) {
      const planPath = path.join(
        this.probe.repo,
        'planning',
        '0000064-production-review.md',
      );
      await fs.appendFile(
        planPath,
        [
          '',
          '### Task 2. Final Review Revalidation',
          '',
          '- Task Status: `__in_progress__`',
          '',
          '#### Subtasks',
          '',
          '1. [ ] Revalidate the direct review fix.',
          '',
          '#### Testing',
          '',
          '1. [ ] Run final proof.',
          '',
        ].join('\n'),
      );
    }

    if (message.includes('# Audit the agent-native review settlement')) {
      const activePath = path.join(
        this.probe.repo,
        'codeInfoStatus',
        'flow-state',
        'active-review-cycle.json',
      );
      const active = JSON.parse(await fs.readFile(activePath, 'utf8')) as {
        review_cycle_id: string;
      };
      await execFile(
        'python3',
        [
          path.join(repositoryRoot, 'scripts', 'record_review_cycle_outcome.py'),
          '--repo-root',
          this.probe.repo,
          '--cycle-id',
          active.review_cycle_id,
          '--status',
          'completed',
        ],
        { cwd: this.probe.repo },
      );
    }

    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const waitForTerminalFlowStatus = async (conversationId: string) => {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const conversation = memoryConversations.get(conversationId);
    const flow = conversation?.flags?.flow as
      | { runLifecycle?: { status?: string } }
      | undefined;
    const status = flow?.runLifecycle?.status;
    if (status && status !== 'running') return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for production review flow completion.');
};

const reviewRepoEntry = (repo: string): RepoEntry => ({
  id: 'production-review-repo',
  description: null,
  containerPath: repo,
  hostPath: repo,
  lastIngestAt: '2026-07-21T00:00:00.000Z',
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
  counts: { files: 1, chunks: 1, embedded: 1 },
  lastError: null,
});

test('production two-phase path reviews a direct-fix commit on a new HEAD before one-shot settlement and outer re-entry', async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'production-review-reentry-'),
  );
  const repo = path.join(temporary, 'repo');
  const flowDirectory = path.join(temporary, 'flows');
  const previousFlowsDirectory = process.env.FLOWS_DIR;
  const previousAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(flowDirectory, { recursive: true });

  try {
    await execFile('git', ['init', '-b', 'main'], { cwd: repo });
    await execFile('git', ['config', 'user.name', 'Review Integration'], {
      cwd: repo,
    });
    await execFile('git', ['config', 'user.email', 'review@example.com'], {
      cwd: repo,
    });
    await fs.mkdir(path.join(repo, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repo, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(path.join(repo, '.gitignore'), 'codeInfoTmp/\n');
    await fs.writeFile(path.join(repo, 'feature.txt'), 'initial\n');
    const planPath = 'planning/0000064-production-review.md';
    await fs.writeFile(
      path.join(repo, planPath),
      [
        '# Story 64',
        '',
        '## Description',
        '',
        'Exercise the production review loop.',
        '',
        '## Acceptance Criteria',
        '',
        '- Direct fixes are reviewed on a new HEAD.',
        '',
        '## Out Of Scope',
        '',
        '- Provider-specific output schemas.',
        '',
        '### Task 1. Initial Implementation',
        '',
        '- Task Status: `__done__`',
        '',
        '#### Subtasks',
        '',
        '1. [x] Implemented.',
        '',
        '#### Testing',
        '',
        '1. [x] Proven.',
        '',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(repo, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({ plan_path: planPath, branched_from: 'main' }),
    );
    await execFile('git', ['add', '.'], { cwd: repo });
    await execFile('git', ['commit', '-m', 'DEV-64 - Initial fixture'], {
      cwd: repo,
    });
    await execFile(
      'git',
      ['checkout', '-b', 'feature/0000064-production-review'],
      { cwd: repo },
    );
    const initialHead = await currentHead(repo);

    const productionCycle = JSON.parse(
      await fs.readFile(
        path.join(repositoryRoot, 'flows', 'two_phase_review_cycle.json'),
        'utf8',
      ),
    ) as { description: string; steps: Array<Record<string, unknown>> };
    const repeatedLoop = productionCycle.steps[1] as {
      steps: Array<Record<string, unknown>>;
    };
    const repeatedWave = repeatedLoop.steps[0] as {
      groups: Array<{
        bindings: { inputValues: { review_groups: unknown[] } };
      }>;
    };
    repeatedWave.groups[0]!.bindings.inputValues.review_groups = [
      {
        kind: 'matrix',
        id: 'integration_repeated',
        itemsFrom: 'review_batch_targets.targets',
        itemName: 'target',
        flowNames: ['integration_repeated_review'],
        bindings: { workingFolderFrom: 'target.repo_root' },
      },
    ];
    const oneShotWave = productionCycle.steps[2] as {
      groups: Array<{
        bindings: { inputValues: { review_groups: unknown[] } };
      }>;
    };
    oneShotWave.groups[0]!.bindings.inputValues.review_groups = [
      {
        kind: 'matrix',
        id: 'integration_one_shot',
        itemsFrom: 'review_batch_targets.targets',
        itemName: 'target',
        flowNames: ['integration_one_shot_review'],
        bindings: { workingFolderFrom: 'target.repo_root' },
      },
    ];
    await fs.writeFile(
      path.join(flowDirectory, 'two_phase_review_cycle.json'),
      JSON.stringify(productionCycle, null, 2),
    );
    await fs.copyFile(
      path.join(repositoryRoot, 'flows', 'review_batch.json'),
      path.join(flowDirectory, 'review_batch.json'),
    );
    await fs.writeFile(
      path.join(flowDirectory, 'integration_repeated_review.json'),
      JSON.stringify({
        description: 'integration repeated review',
        steps: [
          {
            type: 'llm',
            agentType: 'review_agent_heavy',
            identifier: 'integration_repeated',
            messages: [
              { role: 'user', content: ['INTEGRATION REPEATED REVIEW'] },
            ],
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(flowDirectory, 'integration_one_shot_review.json'),
      JSON.stringify({
        description: 'integration one-shot review',
        steps: [
          {
            type: 'llm',
            agentType: 'review_agent_heavy',
            identifier: 'integration_one_shot',
            messages: [
              { role: 'user', content: ['INTEGRATION ONE-SHOT REVIEW'] },
            ],
          },
        ],
      }),
    );

    process.env.FLOWS_DIR = flowDirectory;
    process.env.CODEINFO_CODEX_AGENT_HOME = path.join(
      repositoryRoot,
      'codex_agents',
    );
    installDeterministicCodexAvailabilityBootstrap();
    __setFlowServiceDepsForTests({
      runReingestRepository: async ({ sourceId }) => ({
        ok: true,
        value: {
          status: 'completed',
          operation: 'reembed',
          runId: 'review-reentry-run',
          sourceId: sourceId ?? repo,
          resolvedRepositoryId: 'production-review-repo',
          completionMode: 'reingested',
          durationMs: 1,
          files: 1,
          chunks: 1,
          embedded: 1,
          errorCode: null,
        },
      }),
    });
    const probe: ProductionReviewProbe = {
      repo,
      repeatedHeads: [],
      oneShotHeads: [],
      directFixCalls: 0,
      breakCalls: 0,
    };
    const result = await startFlowRun({
      flowName: 'two_phase_review_cycle',
      source: 'REST',
      working_folder: repo,
      chatFactory: () => new ProductionReviewChat(probe),
      listIngestedRepositories: async () => ({
        repos: [reviewRepoEntry(repo)],
        lockedModelId: null,
      }),
    });
    const terminalStatus = await waitForTerminalFlowStatus(result.conversationId);
    assert.equal(terminalStatus, 'ok');

    const fixedHead = await currentHead(repo);
    assert.notEqual(fixedHead, initialHead);
    assert.equal(probe.breakCalls, 2, JSON.stringify(probe));
    assert.equal(probe.directFixCalls, 3, JSON.stringify(probe));
    assert.deepEqual(probe.repeatedHeads, [initialHead, fixedHead]);
    assert.deepEqual(probe.oneShotHeads, [fixedHead]);

    const active = JSON.parse(
      await fs.readFile(
        path.join(repo, 'codeInfoStatus', 'flow-state', 'active-review-cycle.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(active.status, 'completed');
    const updatedPlan = await fs.readFile(path.join(repo, planPath), 'utf8');
    assert.match(updatedPlan, /### Task 2\. Final Review Revalidation/u);
    assert.match(updatedPlan, /- Task Status: `__in_progress__`/u);

    const outerDecision = await execFile(
      'python3',
      [
        path.join(
          repositoryRoot,
          'scripts',
          'flow_control',
          'check_plan_scope_story_complete.py',
        ),
      ],
      {
        cwd: repo,
        env: { ...process.env, CODEINFO_ROOT: repositoryRoot },
      },
    );
    assert.match(outerDecision.stdout, /"answer":\s*"no"/u);
  } finally {
    if (previousFlowsDirectory === undefined) delete process.env.FLOWS_DIR;
    else process.env.FLOWS_DIR = previousFlowsDirectory;
    if (previousAgentHome === undefined) delete process.env.CODEINFO_CODEX_AGENT_HOME;
    else process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentHome;
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
