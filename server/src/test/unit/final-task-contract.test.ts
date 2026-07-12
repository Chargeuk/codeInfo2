import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

describe('final task contract', () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );

  const read = (relativePath: string) =>
    fs.readFile(path.join(repoRoot, relativePath), 'utf8');

  test('defines a repository-agnostic final lifecycle for every worked-on repository', async () => {
    const contract = await read(
      'codeinfo_markdown/shared/final-task-creation.md',
    );

    assert.match(contract, /repository-agnostic contract/);
    assert.match(contract, /dedicated final validation task/);
    assert.match(contract, /run the supported lint command and fix issues\./);
    assert.match(
      contract,
      /run the supported formatting command and fix issues\./,
    );
    assert.match(
      contract,
      /exactly two checklist items for each repository worked on by the story/,
    );
    assert.match(
      contract,
      /Immediately below the final task's `Subtasks` heading/,
    );
    assert.match(
      contract,
      /Immediately below the final task's `Testing` heading/,
    );
    assert.match(contract, /Do not reopen an older task solely to own that repair/);
    assert.match(
      contract,
      /Do not reopen older tasks solely because their implementation is implicated/,
    );
    assert.match(contract, /every supported full automated test suite/);
    assert.match(contract, /End-to-end coverage is mandatory/);
    assert.match(contract, /full build; startup.*full automated test suite; shutdown/);
    assert.match(contract, /Do not add startup or shutdown.*no supported runtime/);
    assert.match(contract, /Do not invent commands/);
    assert.match(contract, /Do not add.*targeting filters/);
    assert.match(
      contract,
      /runtime exception to the initial lint-and-format-only rule/,
    );
  });

  test('loads the shared contract before initial task generation and in every review task-up command', async () => {
    const initial = JSON.parse(
      await read('codeinfo_agents/tasking_agent/commands/task_up2.json'),
    ) as { items: Array<{ markdownFile?: string }> };
    const initialFiles = initial.items.map((item) => item.markdownFile);

    assert.ok(
      initialFiles.indexOf('shared/final-task-creation.md') <
        initialFiles.indexOf('task_up/04-generate.md'),
    );

    const reviewCommands = [
      'codeinfo_agents/planning_agent/commands/task_up_review_tasks.json',
      'codeinfo_agents/planning_agent_lite/commands/task_up_review_tasks.json',
      'manual_testing/codeinfo_agents/planning_agent/commands/task_up_review_tasks.json',
      'codeinfo_agents/planning_agent/commands/enhance_review_tasks.json',
      'codeinfo_agents/planning_agent_lite/commands/enhance_review_tasks.json',
      'manual_testing/codeinfo_agents/planning_agent/commands/enhance_review_tasks.json',
    ];

    for (const commandPath of reviewCommands) {
      const command = JSON.parse(await read(commandPath)) as {
        items: Array<{ markdownFile?: string }>;
      };
      assert.ok(
        command.items.some(
          (item) => item.markdownFile === 'shared/final-task-creation.md',
        ),
        commandPath,
      );
    }
  });

  test('keeps review creation, minor revalidation, execution, and flow audits aligned', async () => {
    const requiredReferences = [
      'codeinfo_markdown/ensure_review_findings_became_tasks.md',
      'codeinfo_markdown/ensure_task_testing_matches_current_contract.md',
      'codeinfo_markdown/generate_or_update_minor_fix_revalidation_task.md',
      'codeinfo_markdown/review_disposition.md',
      'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
      'codeinfo_markdown/deep_test_failure_repair.md',
      'codeinfo_markdown/audit_after_automated_proof.md',
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ];

    for (const relativePath of requiredReferences) {
      const content = await read(relativePath);
      assert.match(content, /shared\/final-task-creation\.md/, relativePath);
    }

    const minorRevalidation = await read(
      'codeinfo_markdown/generate_or_update_minor_fix_revalidation_task.md',
    );
    assert.match(
      minorRevalidation,
      /exactly two checklist items per worked-on repository in this order/,
    );
    assert.match(
      minorRevalidation,
      /non-checkbox final-task repair-scope note/,
    );
    assert.match(minorRevalidation, /every repository-supported full automated suite/);
    assert.match(minorRevalidation, /every supported end-to-end suite/);
    assert.match(minorRevalidation, /full build, applicable startup/);
    assert.match(minorRevalidation, /matching shutdown/);

    const automatedProof = await read(
      'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
    );
    assert.match(automatedProof, /whole approved story is repair scope/);
    assert.match(automatedProof, /same final task/);
    assert.match(automatedProof, /different numbered task only when/);

    for (const flowPath of [
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ]) {
      const flow = await read(flowPath);
      assert.match(flow, /one discovered lint and one discovered formatting/, flowPath);
      assert.match(flow, /full build, applicable startup/, flowPath);
      assert.match(flow, /matching shutdown/, flowPath);
    }
  });

  test('keeps substantive review-task rules from overriding the final task', async () => {
    const reviewTaskUp = await read(
      'codeinfo_markdown/ensure_review_findings_became_tasks.md',
    );
    assert.match(
      reviewTaskUp,
      /dedicated final task's per-repository lint and formatting checklist is the explicit exception/,
    );
    assert.match(
      reviewTaskUp,
      /newly added substantive review-created task hides runnable/,
    );

    const reviewDisposition = await read(
      'codeinfo_markdown/review_disposition.md',
    );
    assert.match(
      reviewDisposition,
      /dedicated final revalidation task follows .*shared\/final-task-creation\.md.* instead/,
    );
    assert.match(
      reviewDisposition,
      /dedicated final task's per-repository lint and formatting checklist is the explicit exception/,
    );

    for (const testingPrompt of [
      'codeinfo_markdown/task_up/09-proof-and-testing.md',
      'codeinfo_markdown/ensure_task_testing_matches_current_contract.md',
    ]) {
      const testingContract = await read(testingPrompt);
      assert.match(
        testingContract,
        /For each non-final task's affected repository or project/,
        testingPrompt,
      );
      assert.match(testingContract, /full build, applicable startup/, testingPrompt);
      assert.match(testingContract, /matching shutdown/, testingPrompt);
    }
  });
});
