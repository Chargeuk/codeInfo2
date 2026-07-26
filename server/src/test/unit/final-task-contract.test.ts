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
    assert.match(contract, /When newly created or reopened with new unchecked work/);
    assert.match(contract, /Normal execution may promote it to `__in_progress__`/);
    assert.doesNotMatch(contract, /final task must remain `Task Status: __to_do__`/);
    assert.match(contract, /run the supported lint command and fix issues\./);
    assert.match(
      contract,
      /run the supported formatting command and fix issues\./,
    );
    assert.match(
      contract,
      /only the supported lint and formatting checklist-item types for each repository worked on by the story/,
    );
    assert.match(contract, /Discover lint and formatting independently/);
    assert.match(contract, /Omit a repository's lint item/);
    assert.match(contract, /omit its formatting item/);
    assert.match(contract, /Do not invent a command or add a placeholder/);
    assert.match(
      contract,
      /Immediately below the final task's `Subtasks` heading/,
    );
    assert.match(
      contract,
      /Immediately below the final task's `Testing` heading/,
    );
    assert.match(contract, /failures found by these checks/);
    assert.match(contract, /rerun every affected check/);
    assert.doesNotMatch(contract, /failures found by these suites/);
    assert.match(contract, /Do not reopen an older task solely to own that repair/);
    assert.match(
      contract,
      /Do not reopen older tasks solely because their implementation is implicated/,
    );
    assert.match(contract, /every supported full automated test suite/);
    assert.match(contract, /End-to-end coverage is mandatory/);
    assert.match(
      contract,
      /full build; startup.*full automated test suite; shutdown.*supported lint; supported formatting/,
    );
    assert.match(
      contract,
      /After shutdown and all full suites have passed.*supported lint command.*supported formatting command/,
    );
    assert.match(contract, /Do not add startup or shutdown.*no supported runtime/);
    assert.match(contract, /Do not invent commands/);
    assert.match(contract, /Do not add.*targeting filters/);
    assert.match(contract, /confirms.*no supported automated test suite/);
    assert.match(contract, /omit that suite item and continue/);
    assert.match(
      contract,
      /no supported automated test suite.*continue with every other supported full build, applicable startup, matching shutdown, lint, and formatting check in that order/,
    );
    assert.doesNotMatch(
      contract,
      /continue with every other supported build, runtime, lint, and formatting check/,
    );
    assert.match(
      contract,
      /Do not invent a test command, placeholder, harness, proof-authoring subtask, or blocker/,
    );
    assert.match(contract, /missing, unreadable, or otherwise cannot be inspected/);
    assert.match(
      contract,
      /runtime exception to the initial lint-and-format-only rule/,
    );
    assert.doesNotMatch(contract, /Keep lint and formatting out of.*`Testing`/);
    assert.doesNotMatch(contract, /exactly two checklist items for each repository/);
  });

  test('loads the shared contract before initial task generation and in every review task-up command', async () => {
    const initial = JSON.parse(
      await read('codeinfo_agents/tasking_agent/commands/task_up2.json'),
    ) as { items: Array<{ markdownFile?: string }> };
    const initialFiles = initial.items.map((item) => item.markdownFile);

    const sharedContractIndex = initialFiles.indexOf(
      'shared/final-task-creation.md',
    );
    const generateIndex = initialFiles.indexOf('task_up/04-generate.md');
    assert.notEqual(sharedContractIndex, -1);
    assert.notEqual(generateIndex, -1);
    assert.ok(sharedContractIndex < generateIndex);

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

    const finalTaskConsumers = [
      ...requiredReferences,
      'codeinfo_markdown/task_up/01-shared-contract.md',
      'codeinfo_markdown/task_up/04-generate.md',
      'codeinfo_markdown/task_up/05-subtask-granularity.md',
      'codeinfo_markdown/task_up/06-proof-matrix.md',
      'codeinfo_markdown/task_up/07-test-case-expansion.md',
      'codeinfo_markdown/task_up/08-stateful-ui-proof.md',
      'codeinfo_markdown/task_up/09-proof-and-testing.md',
      'codeinfo_markdown/task_up/10-test-semantics-audit.md',
      'codeinfo_markdown/task_up/11-review-preemption-audit.md',
      'codeinfo_markdown/task_up/12-subtasks-and-testing-separation.md',
      'codeinfo_markdown/task_up/13-junior-executor-audit.md',
      'codeinfo_markdown/task_up/14-finalize.md',
      'codeinfo_markdown/review_task_enhancement/01-shared-contract.md',
      'codeinfo_markdown/review_task_enhancement/02b-risk-and-prerequisite-scan.md',
      'codeinfo_markdown/review_task_enhancement/03-finalize.md',
      'codeinfo_markdown/review_task_enhancement/04-check-quality.md',
      'codeinfo_markdown/review_task_enhancement/05-compact-granularity.md',
      'codeinfo_markdown/review_task_enhancement/07-compact-proof-expansion.md',
      'codeinfo_markdown/review_task_enhancement/09-compact-proof-and-testing.md',
    ];
    const forbiddenLegacyRules = [
      /failures found by these suites/,
      /create a bounded proof-authoring subtask and an automated testing placeholder/,
      /final lint then prettier testing steps/,
      /do(?:es)? not duplicate lint or formatting/,
      /two-initial-subtask shape/,
      /record a live blocker that names the unavailable proof/,
    ];

    for (const relativePath of finalTaskConsumers) {
      const content = await read(relativePath);
      for (const forbiddenRule of forbiddenLegacyRules) {
        assert.doesNotMatch(content, forbiddenRule, relativePath);
      }
    }

    const reviewTaskUp = await read(
      'codeinfo_markdown/ensure_review_findings_became_tasks.md',
    );
    const supportedLifecycleInventory =
      /its discovered supported full build when available, applicable startup, every relevant repository-supported full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting, in that order, with unsupported or unavailable items omitted/;
    for (const sectionName of [
      'decision_rules',
      'repair_rules',
      'verification_loop',
    ]) {
      const section = reviewTaskUp.match(
        new RegExp(`<${sectionName}>[\\s\\S]*?</${sectionName}>`),
      )?.[0];
      assert.ok(section, `missing ${sectionName} section`);
      assert.match(section, supportedLifecycleInventory, sectionName);
    }
    assert.doesNotMatch(
      reviewTaskUp,
      /lint, formatting, build, runtime, and full-suite validation/,
    );
    assert.doesNotMatch(
      reviewTaskUp,
      /a discovered full build, applicable startup, relevant full-suite/,
    );

    const reviewEnhancementContract = await read(
      'codeinfo_markdown/review_task_enhancement/01-shared-contract.md',
    );
    assert.match(
      reviewEnhancementContract,
      /discovered supported full build when available, applicable startup, every relevant full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting/,
    );
    assert.doesNotMatch(
      reviewEnhancementContract,
      /gives each repository a full build, applicable startup, relevant full-suite/,
    );

    const minorRevalidation = await read(
      'codeinfo_markdown/generate_or_update_minor_fix_revalidation_task.md',
    );
    assert.match(
      minorRevalidation,
      /only supported lint and formatting checklist-item types per worked-on repository/,
    );
    assert.match(
      minorRevalidation,
      /non-checkbox final-task repair-scope note/,
    );
    assert.match(minorRevalidation, /every repository-supported full automated suite/);
    assert.match(minorRevalidation, /every supported end-to-end suite/);
    assert.match(minorRevalidation, /full build, applicable startup/);
    assert.match(minorRevalidation, /matching shutdown/);
    assert.match(
      minorRevalidation,
      /matching shutdown, supported lint, and supported formatting in that order/,
    );
    assert.match(minorRevalidation, /omit unsupported commands/);
    assert.match(minorRevalidation, /Do not add a proof-authoring subtask/);
    assert.match(minorRevalidation, /Do not add.*automated testing placeholder/);
    assert.match(minorRevalidation, /omit the unavailable suite item and continue/);
    assert.match(minorRevalidation, /affected repository or affected component/);
    assert.doesNotMatch(minorRevalidation, /suite exists for the affected files/);
    assert.match(minorRevalidation, /every validation item made stale/);
    assert.match(
      minorRevalidation,
      /affected lint and formatting items in `Subtasks` and affected build, startup, full-suite, shutdown, lint, and formatting items in `Testing`/,
    );
    assert.doesNotMatch(
      minorRevalidation,
      /build, runtime, full-suite, shutdown, lint, and formatting items in both `Subtasks` and `Testing`/,
    );
    assert.match(minorRevalidation, /non-blocking `Implementation Notes` entry/);
    assert.match(minorRevalidation, /repository is missing or unreadable/);
    assert.doesNotMatch(
      minorRevalidation,
      /record a live blocker that names the unavailable proof/,
    );
    assert.match(
      minorRevalidation,
      /final_minor_fix_revalidation\\`` in `Implementation Notes`/,
    );
    assert.match(
      minorRevalidation,
      /<review_cycle_id>\\`` in `Implementation Notes`/,
    );

    const automatedProof = await read(
      'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
    );
    assert.match(automatedProof, /whole approved story is repair scope/);
    assert.match(automatedProof, /same final task/);
    assert.match(automatedProof, /different numbered task only when/);
    assert.match(
      automatedProof,
      /uncheck every affected validation item made stale including build, startup, full-suite, shutdown, lint, and formatting items/,
    );
    assert.doesNotMatch(
      automatedProof,
      /uncheck every suite and later lint or formatting item made stale/,
    );

    for (const repairPromptPath of [
      'codeinfo_markdown/audit_after_automated_proof.md',
      'codeinfo_markdown/deep_test_failure_repair.md',
    ]) {
      const repairPrompt = await read(repairPromptPath);
      assert.match(repairPrompt, /every (?:affected )?validation item/);
      assert.match(repairPrompt, /earliest stale step/);
      assert.match(
        repairPrompt,
        /build, startup, full-suite, shutdown, lint, and formatting/,
      );
    }

    for (const flowPath of [
      'flows/task_and_implement_plan.json',
      'flows/improve_task_implement_plan.json',
    ]) {
      const flow = await read(flowPath);
      assert.match(flow, /independently discovered supported lint and formatting/, flowPath);
      assert.match(flow, /full build, applicable startup/, flowPath);
      assert.match(flow, /matching shutdown/, flowPath);
      assert.match(
        flow,
        /matching shutdown, supported lint, and supported formatting in that order/,
        flowPath,
      );
      assert.match(flow, /omits unsupported commands/, flowPath);
      assert.doesNotMatch(flow, /final lint then prettier testing steps/, flowPath);
      assert.doesNotMatch(flow, /does not duplicate lint or formatting/, flowPath);
    }

    for (const promptPath of [
      'codeinfo_markdown/task_up/11-review-preemption-audit.md',
      'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
    ]) {
      const prompt = await read(promptPath);
      assert.doesNotMatch(prompt, /two-initial-subtask shape/, promptPath);
      assert.match(prompt, /supported lint.*supported formatting/, promptPath);
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

    const separationPrompt = await read(
      'codeinfo_markdown/task_up/12-subtasks-and-testing-separation.md',
    );
    assert.match(separationPrompt, /each substantive task still has explicit proof-authoring/);
    assert.match(separationPrompt, /Exclude the dedicated final validation task/);

    const generationPrompt = await read(
      'codeinfo_markdown/task_up/04-generate.md',
    );
    assert.match(generationPrompt, /Except for the dedicated final validation task/);
    assert.match(generationPrompt, /end each non-final task's `Subtasks` section/);
    assert.match(
      generationPrompt,
      /Each substantive implementation task must belong to exactly one repository/,
    );
    assert.match(
      generationPrompt,
      /dedicated final validation task is the exception.*one administrative `Repository Name`.*every proof-scope repository/,
    );
    assert.match(
      generationPrompt,
      /do not split the dedicated final validation task by repository/,
    );
    assert.match(
      generationPrompt,
      /Each substantive implementation task must implement exactly one primary seam/,
    );
    assert.match(
      generationPrompt,
      /Add explicit proof-authoring subtasks to substantive implementation tasks whenever/,
    );
    assert.match(
      generationPrompt,
      /each Acceptance Criterion.*named proof-authoring subtasks in its owning substantive task/,
    );
    assert.doesNotMatch(
      generationPrompt,
      /- Each task must implement exactly one primary seam/,
    );
    assert.doesNotMatch(
      generationPrompt,
      /- Add explicit proof-authoring subtasks whenever/,
    );

    const minorRevalidation = await read(
      'codeinfo_markdown/generate_or_update_minor_fix_revalidation_task.md',
    );
    assert.match(
      minorRevalidation,
      /no repository-supported automated test suite.*continue with every other supported full build, applicable startup, matching shutdown, lint, and formatting check in that order/,
    );
    assert.doesNotMatch(
      minorRevalidation,
      /continue with every other supported build, runtime, lint, and formatting check/,
    );

    const riskPrompt = await read(
      'codeinfo_markdown/review_task_enhancement/02b-risk-and-prerequisite-scan.md',
    );
    assert.match(riskPrompt, /During initial task creation and enhancement/);
    assert.match(riskPrompt, /bounded same-task repair exception/);

    const finalizePrompt = await read('codeinfo_markdown/task_up/14-finalize.md');
    assert.match(finalizePrompt, /supported lint and formatting subtasks/);
    assert.doesNotMatch(finalizePrompt, /prettier or format-check/);

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
      assert.match(
        testingContract,
        /matching shutdown, supported lint, and supported formatting in that order/,
        testingPrompt,
      );
      assert.match(testingContract, /unsupported commands/, testingPrompt);
    }
  });

  test('keeps settlement and proof agents tolerant of imperfect evidence and manual task-shape errors', async () => {
    for (const promptPath of [
      'codeinfo_markdown/settle_agent_native_review_pass.md',
      'codeinfo_markdown/apply_agent_native_review_settlement.md',
      'codeinfo_markdown/audit_agent_native_review_settlement.md',
    ]) {
      const prompt = await read(promptPath);
      assert.match(prompt, /attempts\//u, promptPath);
      assert.match(prompt, /imperfect|imperfections/u, promptPath);
      assert.match(prompt, /schemas|schema/u, promptPath);
      assert.match(prompt, /Manual Testing Guidance/u, promptPath);
      assert.match(prompt, /manual.*(?:blocker|blocking)/isu, promptPath);
    }

    for (const promptPath of [
      'codeinfo_markdown/normalize_inconsistent_active_task.md',
      'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
      'codeinfo_markdown/audit_after_automated_proof.md',
      'codeinfo_markdown/research_blocker_impact_on_plan.md',
    ]) {
      const prompt = await read(promptPath);
      assert.match(prompt, /by meaning|semantically/u, promptPath);
      assert.match(prompt, /Manual Testing Guidance/u, promptPath);
      assert.match(prompt, /remove only the misplaced checklist item/u, promptPath);
      assert.match(prompt, /retire.*blocker/isu, promptPath);
    }
  });
});
