# Goal

Finish the current story review using ONLY the stored review handoff and the artifacts it references, then decide how the canonical plan must respond to the findings.

<critical_rules>

- Do NOT rediscover review artifacts by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and determine the canonical `plan_path`, then extract repository paths from `additional_repositories`.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json`, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit any plan.
- If the review handoff is stale or incomplete, stop and say the review must be rerun. Do not edit any plan.
- Treat `flows/**` as approved workflow configuration. Do not reopen the story or record scope-creep findings solely because those files changed without being named in the active plan.
- Only reopen if the review shows those `flows/**` changes introduced incorrect workflow behavior, broke repository contracts, or require explicit follow-up validation work.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not reopen the story, request reverts, or record scope-creep findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, spelling, grammar, and obvious wording findings remain actionable, and explicit hygiene/security findings are also actionable when they involve:
  - hard-coded secrets, tokens, credentials, or API keys;
  - tracked files under ignored paths;
  - checked-in local config that should remain template-only;
  - tracked temp, generated, or runtime artifact directories.
- Do not add revert tasks, scope-cleanup tasks, or workflow-correctness tasks for those files unless the follow-up is directly addressing one of those explicit hygiene/security issues.
- This is the only review step allowed to mutate plans.
- This step is not complete until you re-open the canonical plan from disk after your edits and verify that the plan state now matches the stored review outcome for the current review pass.

</critical_rules>

<scope_rules>

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus the repository paths extracted from `additional_repositories`.
- Read `codeInfoTmp/reviews/<story-number>-current-review.json`, derived from the shared story number, and verify that its:
  - `story_id`
  - `plan_path`
  - `review_pass_id`
  - `evidence_file`
  - `findings_file`
  - optional `saturation_file`
  - `repos` entries, including stable `repo_alias`, `repo_root`, `branch`, `resolved_base_branch`, and `head_commit`
    still match the normalized review scope and current repository state for every selected repository.
- Treat each stored `resolved_base_branch` as the already-resolved review base chosen by the evidence step. It may come either from the repository default branch or from branch ancestry hinted by `current-plan.json`, so do not re-resolve a different base in this step unless the review handoff is stale and must be rerun.
- If the review handoff includes `saturation_file`, treat it as optional additive context for this pass. Read it when present.
- If the review handoff includes `challenge_file`, treat it as optional additive context for this pass. Read it when present.
- If `challenge_file` is absent, derive the same reasoning directly from the evidence and findings artifacts instead of failing or asking for a rerun.
- If `saturation_file` is absent because an older flow snapshot is still running, continue using the findings artifact as the canonical endorsed-findings source instead of failing or asking for a rerun.

</scope_rules>

<validation_rules>

Before deciding disposition, validate all of the following:

- the canonical plan exists;
- the canonical plan filename story number still matches the current repository branch story number;
- every repository in scope is still on a branch whose story number matches the canonical plan filename;
- the review handoff is complete and still matches the normalized review scope, canonical `plan_path`, and current repository state.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review handoff is stale or incomplete, stop and say the review must be rerun.

</validation_rules>

<disposition_rules>

1. If any `must_fix` or `should_fix` findings exist, reopen the story in the canonical plan.
2. Add a `Code Review Findings` summary section to the physical END of the canonical plan file.
3. Add explicit follow-up tasks using the same structure as previous tasks immediately AFTER the newly added `Code Review Findings` so they form one contiguous appended block at the end of the file.
4. Add a fresh full re-test/final validation task immediately after those review-fix tasks so the story must be revalidated against the acceptance criteria.
5. Update numbering and cross-references if needed.
6. Every new review-fix task MUST name exactly one repository using `Repository Name`.
7. For cross-repository findings, keep the work in the one canonical plan but split it into repository-specific tasks and make sequencing explicit.
8. Every new review-fix task MUST use the canonical section contract:
   - `Subtasks` for implementation and proof-authoring work only;
   - automated-only `Testing`;
   - optional, non-blocking `Manual Testing Guidance` only when useful.
9. Never create a review-fix subtask or testing step that requires manual testing to have already happened.
10. Never create a review-fix subtask that requires automated test execution results to become complete.
11. Default to one review-fix task per shared `Repository Name` + repair seam/root cause + proof surface. Do not create one task per endorsed finding when multiple findings can be repaired and validated together honestly.
12. When several endorsed findings in the same repository affect the same implementation seam, state contract, lifecycle, proof home, or closely adjacent support surface, merge them into one substantive review-fix task unless a split is required for clarity, ownership, sequencing, or proof honesty.
13. Tiny unrelated low-risk findings in the same repository may be absorbed into a nearby substantive review-fix task when they do not require materially different ownership or proof and do not make that task vague, bloated, or difficult to execute.
14. If several tiny unrelated low-risk findings have no natural parent task, group them into one small cleanup task instead of creating one task per finding.
15. Never use minor-fix absorption or cleanup grouping to create a junk-drawer task. If the combined task loses a clear stopping point, seam, or proof story, split it back apart.
16. If a finding is in an allowed support file, any follow-up task for that file may only request spelling, grammar, wording, or the explicit hygiene/security cleanup needed to remove the secret or artifact problem.
17. If only `optional_simplification` findings exist, reopen the canonical plan when the simplification is localized to files already changed by the story, low-risk, objectively testable, and improves a shared contract such as logging vocabulary, marker schema, configuration consistency, or cross-repository compatibility.
18. Only defer an `optional_simplification` when the cleanup is speculative, broad, or not worth the churn.
19. If an `optional_simplification` is deferred, record it in a short review note instead of reopening.
20. This `optional_simplification` rule does not permit reopening an allowed support file for anything other than spelling, grammar, or wording corrections.
21. If there are no findings, append a `Post-Implementation Code Review` section to the end of the canonical plan detailing:
    - the branch-vs-base checks performed across all repositories in scope;
    - the acceptance-evidence checks performed;
    - the files inspected;
    - why each repository in scope remains complete;
    - why the story remains complete;
    - the rejected-risk notes carried forward from the findings artifact, plus any blind-spot challenge follow-up when that extra artifact exists.
22. For multi-repository stories with no findings, also record why the cross-repository integration evidence was sufficient.
23. When the review is assessing the planned work, it MUST explicitly state whether each acceptance criterion has direct proof, indirect proof, or missing proof, and whether the implemented code is appropriately succinct for the required behavior or contains simplification opportunities.
24. Even when there are no findings, the `Post-Implementation Code Review` section MUST state whether the generic adversarial checklist had direct proof, indirect proof, or missing proof for:
    - execution-routing or harness dependence;
    - default launcher, wrapper, dispatcher, CI, or startup-path inclusion;
    - shared-state or concurrency safety;
    - reader and writer atomicity or partial-write tolerance;
    - cleanup ownership or stale-state safety;
    - lifecycle ordering;
    - test isolation.
25. If any of those areas remain weakly proven, record that residual risk explicitly rather than implying the review was exhaustive.
26. The current pass `evidence_file`, `findings_file`, optional `saturation_file`, and optional `challenge_file` are high-quality local review artifacts for this flow run only. Use them as disposition input, but do NOT add them to commits.
27. When the saturation step exists, treat its artifact as additive context for the reopen or no-findings decision. When the saturation step is absent because an older flow snapshot is still running, preserve the same disposition quality by using the findings artifact's endorsed findings and, when present, its `Finding Saturation Seeds` and `Checked Defect Families` sections as the fallback source of that reasoning. Treat those named sections as optional for backward compatibility with older findings artifacts; if they are absent, derive equivalent sibling-scan reasoning from the endorsed findings when possible, or proceed without those sections when that reasoning is not explicitly available.
28. When the challenge step exists, treat its artifact as additive context for the no-findings or reopen decision. When the challenge step is absent because an older flow snapshot is still running, preserve the same disposition quality by using the findings artifact's `Rejected Risk Notes` section as the fallback source of that reasoning.
29. When `finding_counts.must_fix + finding_counts.should_fix > 0`, do not stop after artifact capture, wording cleanup, or support-file-only edits. Re-open the canonical plan from disk and verify that it now contains:
    - a new `Code Review Findings` section for the current `review_pass_id`;
    - at least one new review-created `Task Status: __to_do__` task that responds to the endorsed findings;
    - a fresh final re-test or revalidation task after those new review-fix tasks.
30. Do not insert new review-created tasks into the middle or top of the plan file, even when they describe a prerequisite. Keep them appended at the end of the plan file and express any prerequisite relationship through task wording, dependencies, sequencing notes, and task status rather than insertion position.
31. Before finalizing a findings-present plan, explicitly check whether any adjacent new review-created tasks should be merged because they share repository ownership, repair seam, and proof. Also check whether any tiny low-risk cleanup-only tasks should be absorbed into a nearby substantive task or grouped into one cleanup task instead of remaining separate.
32. If the required findings-present plan mutations are still missing after your first edit, keep editing the plan in this same step until those mutations exist on disk. Do not leave a findings-present review pass encoded only in review artifacts.
33. When `finding_counts.must_fix + finding_counts.should_fix == 0`, re-open the plan after editing and verify that the no-findings path for the current `review_pass_id` is now present on disk as the required `Post-Implementation Code Review` section.
34. If a findings-present repair cannot honestly be made concrete in one pass, add bounded diagnostic review-fix tasks instead of leaving the plan unchanged. The flow must continue with executable task ownership rather than with un-tasked findings.

</disposition_rules>

<review_task_shape_rules>

- Apply these rules whenever this step adds or rewrites review-created follow-up tasks because findings are present.
- Keep runnable build, test, compose, and wrapper commands in each task's automated-only `Testing` section.
- Keep each task's `Subtasks` section for implementation work, proof-authoring work, exact proof-file citations, markers, fixtures, harness surfaces, screenshot path conventions, and other work that can be completed before formal proof runs.
- Allow execution commands to remain in `Subtasks` only when the task is specifically creating, repairing, or proving a harness or wrapper itself.
- Do not create manual testing checklist items in `Subtasks` or `Testing`.
- Do not create subtasks that depend on future automated or manual proof output in order to become complete.
- Place optional manual-testing-agent browser scenarios only in `Manual Testing Guidance`.
- Add `Manual Testing Guidance` only when the reviewed fix changes a browser-visible, runtime-visible, or otherwise externally observable surface that would benefit from optional manual-testing-agent validation.
- When one wrapper run later produces outputs used for validation, keep the execution command once in `Testing` and do not make any follow-up subtask depend on those later outputs in order to become executable.
- Do not create hybrid subtasks such as `run wrapper X and update note Y` when the execution step can live in `Testing` and the resulting proof work can be expressed separately in `Subtasks`.

</review_task_shape_rules>

<mini_example>

- Bad: “Run Playwright against the reviewed flow and save screenshots for the fix.”
- Good: “Update the relevant Playwright proof files, markers, or screenshot naming so later automated or manual validation can verify the reviewed fix.”

</mini_example>

<output_contract>

- Produce the correct plan mutations for the findings outcome:
  - reopen the canonical plan and add review-fix tasks when `must_fix` or `should_fix` findings exist;
  - reopen or defer localized `optional_simplification` findings according to the rules above;
  - append `Post-Implementation Code Review` when there are no findings.
- If this review mutates plans, commit only the resulting plan and code changes. Do not include the scratch review artifacts in the commit history.
- Do not finish this step while the stored review handoff and the canonical plan disagree about whether actionable findings exist.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff and review handoff still match the current repository state.
- Confirm every affected repository has been reflected correctly in the canonical plan updates with explicit repository ownership.
- Confirm cross-repository findings produced explicit sequencing in the canonical plan and final validation.
- Confirm no allowed support file was reopened for anything other than spelling, grammar, wording, or an explicit secret/artifact-hygiene correction.
- Confirm the no-findings path, if used, explicitly recorded acceptance proof and residual risk across all repositories in scope.
- Confirm the no-findings path, if used, explicitly recorded generic adversarial proof or residual risk across all repositories in scope.
- Confirm the no-findings path, if used, carried forward sibling-scan or checked-defect-family reasoning from the saturation artifact when present, or from the findings artifact when the saturation artifact was absent.
- Confirm the no-findings path, if used, carried forward rejected-risk reasoning from the findings artifact and challenge artifact when present.
- Confirm scratch review artifacts are treated as local-only workflow files, the current-plan handoff is not mistaken for the review handoff, and the review handoff remains transient workflow state rather than a commit-worthy repository artifact.
- Confirm that a findings-present pass left new review-created `__to_do__` tasks plus a final revalidation task in the plan, or that a no-findings pass left the required `Post-Implementation Code Review` section for the current `review_pass_id`.
- Confirm that any findings-present pass kept `Testing` automated-only, used `Manual Testing Guidance` only as optional non-blocking guidance, and did not create subtasks that depend on future automated or manual proof output.

</verification_loop>
