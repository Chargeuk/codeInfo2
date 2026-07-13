# Goal

Finish the current story review using ONLY the stored review handoff and the artifacts it references, then decide how the canonical plan must respond to the findings.

<critical_rules>

- Require the server-owned current-review validation artifact to match the exact story/session/pass/HEAD/base identity used by the disposition state. Accept `passed` or `partial`, use findings only from reviewer entries marked usable, and retain failed-review coverage as an incomplete-review warning. Never mix findings from stale or unvalidated reviewer entries.

- Do NOT rediscover review artifacts by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and determine the canonical `plan_path`, then extract repository paths from `additional_repositories`.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then read `codeInfoTmp/reviews/<story-number>-current-review.json`, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit any plan.
- Interpret the review handoff semantically instead of as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the evidence artifact, findings artifact, optional additive artifacts, current-plan handoff, and direct git state to infer the safest usable meaning.
- If the stored review outcome cannot be determined even after safe inference, do not ask for repeated reruns. Mutate the canonical plan only to record a visible incomplete-review follow-up or bounded diagnostic task, and do not close the review as no-findings.
- Treat `flows/**` as approved workflow configuration. Do not reopen the story or record scope-creep findings solely because those files changed without being named in the active plan.
- Only reopen if the review shows those `flows/**` changes introduced incorrect workflow behavior, broke repository contracts, or require explicit follow-up validation work.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not reopen the story, request reverts, or record scope-creep findings solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, spelling, grammar, and obvious wording findings remain actionable, and explicit hygiene/security findings are also actionable when they involve:
  - hard-coded secrets, tokens, credentials, or API keys;
  - tracked files under ignored paths;
  - checked-in local config that should remain template-only;
  - tracked temp, generated, or runtime artifact directories.
- Treat the current pass `evidence_file`, `findings_file`, optional `saturation_file`, and optional `challenge_file` as temporary local review artifacts for this flow run only.
- These review artifacts may live under ignored scratch paths such as `codeInfoTmp/reviews/` and must not be committed.
- Treat `codeInfoTmp/reviews/<story-number>-current-review.json` as transient review handoff state, `codeInfoTmp/reviews/<story-number>-external-review-input.md` as transient review input, and `codeInfoTmp/reviews/<review-pass-id>-blind-spot-challenge.md` as optional additive context rather than required durable artifacts.
- Do not add revert tasks, scope-cleanup tasks, or workflow-correctness tasks for those files unless the follow-up is directly addressing one of those explicit hygiene/security issues.
- Do not reopen the story or create review-fix tasks solely from a finding whose exact `Scope Impact` is `cleanup_preference`, unless the review artifacts show a reproduced current-head failure, the active story explicitly asked for the cleanup, or the user explicitly approved that scope expansion.
- If `Scope Impact` is missing, malformed, or unrecognized, treat it as `unknown_scope_impact`, continue disposition normally, and do not suppress the finding on that basis alone.
- This is the only review step allowed to mutate plans.
- This step is not complete until you re-open the canonical plan from disk after your edits and verify that the plan state now matches the stored review outcome for the current review pass.

</critical_rules>

<scope_rules>

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus the repository paths extracted from `additional_repositories`.
- Read `codeInfoTmp/reviews/<story-number>-current-review.json`, derived from the shared story number, and identify the minimum usable review context either from named handoff fields or by safe inference from the handoff path, canonical `plan_path`, artifact filenames, artifact content, and current git state:
  - story identifier
  - plan path
  - review pass identifier
  - evidence artifact
  - findings artifact
  - optional saturation artifact
  - `repos` entries that identify the selected repositories and current branches, either directly or by safe inference from the artifacts and current git state.
- Prefer stored comparison metadata when present, including `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule`. If `comparison_base_commit` is missing but the base is clear from `comparison_base_ref`, `resolved_base_branch`, or the evidence artifact, resolve that base once and record that the disposition used an inferred base.
- Treat each stored or inferred `comparison_head_ref` as local `HEAD`. The review result must represent the local working branch against the stored or inferred comparison base, not `origin/<current-story-branch>` against the base.
- Treat `remote_name`, `remote_fetch_status`, `resolved_base_source`, `local_fallback_reason`, and any `remote_fetch_error` or `remote_fetch_exit_code` fields as recorded evidence from the evidence step when present. They improve confidence but are not required for older or partially shaped handoffs.
  - Preserve remote-vs-local fallback context when it is present or safely inferable.
  - Do not re-fetch solely to make those past observations match current network or remote availability.
  - If `remote_fetch_error` is present, do not copy raw error text into plan output unless it is already sanitized or can be safely categorized without credentials, userinfo, access tokens, or query strings.
- Do not repeatedly rerun or ask to regenerate review artifacts solely to satisfy handoff formatting. Make one best-effort interpretation from the existing handoff, referenced artifacts, and git state; if the review outcome or comparison basis still cannot be determined, encode that incomplete-review state visibly in the plan rather than closing the review.
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
- the review handoff, after safe inference from referenced artifacts when needed, still describes the normalized review scope, canonical `plan_path`, review outcome, and current repository state well enough to act.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review handoff cannot provide the minimum usable review outcome even after safe inference, do not ask for repeated reruns. Record a visible incomplete-review follow-up in the plan and do not treat the pass as no-findings.

</validation_rules>

<disposition_rules>

1. If any `must_fix` or `should_fix` findings exist, reopen the story in the canonical plan.
2. Add a `Code Review Findings` summary section to the physical END of the canonical plan file.
3. Add explicit follow-up tasks using the same structure as previous tasks immediately AFTER the newly added `Code Review Findings` so they form one contiguous appended block at the end of the file.
4. Add a fresh full re-test/final validation task immediately after those review-fix tasks so the story must be revalidated against the acceptance criteria and the full current review-created findings block for this `review_pass_id`.
5. Update numbering and cross-references if needed.
6. Every new review-fix task MUST name exactly one repository using `Repository Name`.
7. For cross-repository findings, keep the work in the one canonical plan but split it into repository-specific tasks and make sequencing explicit.
8. Every new review-fix task MUST use the canonical section contract:
   - `Subtasks` for implementation and proof-authoring work only;
   - automated-only `Testing`;
   - optional, non-blocking `Manual Testing Guidance` only when useful.
9. Never create a review-fix subtask or testing step that requires manual testing to have already happened.
10. Never create a review-fix subtask that requires automated test execution results to become complete.
11. Default to one review-fix task per shared `Repository Name` plus a coherent repair seam, root cause, contract or lifecycle surface, prerequisite chain, or proof story. Do not create one task per endorsed finding when multiple findings can be repaired and validated together honestly.
12. Treat multiple proof files, proof surfaces, or assertions as proof details inside one review-fix task when the implementation owner, repair seam, root cause, and sequencing are shared.
13. Do not merge findings solely because they are in the same repository or likely have the same implementation owner. Split same-repository findings when no shared implementation reason exists, or when implementation ownership, sequencing, prerequisites, risk level, or proof honesty would become unclear inside one task.
14. When several endorsed findings in the same repository affect the same implementation seam, state contract, lifecycle, proof home, or closely adjacent support surface, merge them into one substantive review-fix task unless a split is required for clarity, ownership, sequencing, or proof honesty.
15. Tiny unrelated low-risk findings in the same repository may be absorbed only into another newly created review-fix task from this same appended review-created block when they do not require materially different ownership or proof and do not make that task vague, bloated, or difficult to execute.
16. If several tiny unrelated low-risk findings have no natural parent task inside this same appended review-created block, group them into one newly created cleanup task inside that block instead of creating one task per finding.
17. Never use minor-fix absorption or cleanup grouping to create a junk-drawer task. If the combined task loses a clear stopping point, seam, or proof story, split it back apart.
    17a. Findings whose exact `Scope Impact` is `cleanup_preference` must not be absorbed into another actionable review-created task or grouped into a cleanup task unless the review artifacts show a reproduced defect, the active story explicitly asked for the cleanup, or the user explicitly approved that scope expansion.
18. Every new review-created task MUST include durable finding coverage in the plan itself, such as an `Addresses Findings` section or equivalent inline wording, that names the endorsed finding labels, summaries, or severities it closes.
19. Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. The fresh dedicated final re-test or revalidation task after a findings-present review block MUST initially contain only the supported lint and formatting checklist-item types per worked-on repository, discovering each command independently and omitting unsupported commands. Its `Testing` MUST give each worked-on repository a discovered full build, applicable startup, every relevant full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting in that order, with unsupported commands omitted and no targeted filters.
    19a. If the active plan explicitly names design-target assets intended as implementation references, review-created follow-up tasks may be added for material mismatch against mandatory visual invariants, or for missing or weak screenshot-to-design comparison analysis only when both the named design assets and usable retained screenshots existed for honest comparison.
    19b. If the active plan explicitly names design-target assets intended as implementation references, review-created follow-up tasks for visual mismatch must follow this precedence order when deciding whether to reopen work: the task-under-review's explicit subtasks and task-level requirements first, then the story plan or `Design Contract`, then paired design markdown, then the supporting visual asset.
    19c. Do not reopen work solely because the implementation differs from a lower-precedence design source when a higher-precedence source explicitly supports the implementation on that same point.
20. If a finding is in an allowed support file, any follow-up task for that file may only request spelling, grammar, wording, or the explicit hygiene/security cleanup needed to remove the secret or artifact problem.
21. If only `optional_simplification` findings exist, reopen the canonical plan when the simplification is localized to files already changed by the story, low-risk, objectively testable, and improves a shared contract such as logging vocabulary, marker schema, configuration consistency, or cross-repository compatibility.
22. Only defer an `optional_simplification` when the cleanup is speculative, broad, or not worth the churn.
23. If an `optional_simplification` is deferred, record it in a short review note instead of reopening.
24. This `optional_simplification` rule does not permit reopening an allowed support file for anything other than spelling, grammar, or wording corrections.
25. If there are no findings, append a `Post-Implementation Code Review` section to the end of the canonical plan detailing:
    - the branch-vs-base checks performed across all repositories in scope;
    - whether each repository reviewed local `HEAD` against a remote-tracking review base or a local fallback, including the fallback reason when available;
    - the stored or inferred `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, and `comparison_rule` for every repository in scope;
    - the acceptance-evidence checks performed;
    - the files inspected;
    - why each repository in scope remains complete;
    - why the story remains complete;
    - the rejected-risk notes carried forward from the findings artifact, plus any blind-spot challenge follow-up when that extra artifact exists.
26. For multi-repository stories with no findings, also record why the cross-repository integration evidence was sufficient.
27. When the review is assessing the planned work, it MUST explicitly state whether each acceptance criterion has direct proof, indirect proof, or missing proof, and whether the implemented code is appropriately succinct for the required behavior or contains simplification opportunities.
28. Even when there are no findings, the `Post-Implementation Code Review` section MUST state whether the generic adversarial checklist had direct proof, indirect proof, or missing proof for:
    - execution-routing or harness dependence;
    - default launcher, wrapper, dispatcher, CI, or startup-path inclusion;
    - shared-state or concurrency safety;
    - reader and writer atomicity or partial-write tolerance;
    - cleanup ownership or stale-state safety;
    - lifecycle ordering;
    - test isolation.
29. If any of those areas remain weakly proven, record that residual risk explicitly rather than implying the review was exhaustive.
30. The current pass `evidence_file`, `findings_file`, optional `saturation_file`, and optional `challenge_file` are temporary local review artifacts for this flow run only. Use them as disposition input, but do NOT add them to commits.
31. When the saturation step exists, treat its artifact as additive context for the reopen or no-findings decision. When the saturation step is absent because an older flow snapshot is still running, preserve the same disposition quality by using the findings artifact's endorsed findings and, when present, its `Finding Saturation Seeds` and `Checked Defect Families` sections as the fallback source of that reasoning. Treat those named sections as optional for backward compatibility with older findings artifacts; if they are absent, derive equivalent sibling-scan reasoning from the endorsed findings when possible, or proceed without those sections when that reasoning is not explicitly available.
32. When the challenge step exists, treat its artifact as additive context for the no-findings or reopen decision. When the challenge step is absent because an older flow snapshot is still running, preserve the same disposition quality by using the findings artifact's `Rejected Risk Notes` section as the fallback source of that reasoning.
33. Determine the review outcome primarily from the findings artifact. Use any `finding_counts` values in the handoff only as helpful summary hints; if the counts disagree with the findings artifact, trust the artifact and record the mismatch in the disposition notes.
34. When the findings artifact communicates actionable `must_fix` or `should_fix` findings, do not stop after artifact capture, wording cleanup, or support-file-only edits. Re-open the canonical plan from disk and verify that it now contains:
    - a new `Code Review Findings` section for the current `review_pass_id`;
    - at least one new review-created `Task Status: __to_do__` task that responds to the endorsed findings;
    - durable finding-to-task coverage inside those review-created tasks;
    - a fresh final re-test or revalidation task after those new review-fix tasks.
35. Do not insert new review-created tasks into the middle or top of the plan file, even when they describe a prerequisite. Keep them appended at the end of the plan file and express any prerequisite relationship through task wording, dependencies, sequencing notes, and task status rather than insertion position.
36. Before finalizing a findings-present plan, explicitly check whether any adjacent new review-created tasks inside the appended review-created block should be merged because they share repository ownership plus a repair seam, root cause, contract or lifecycle surface, prerequisite chain, or coherent proof story, even when they need multiple proof files. Also check whether any tiny low-risk cleanup-only tasks inside that same block should be absorbed into another new review-created task or grouped into one cleanup task instead of remaining separate.
37. Before finalizing any merged or grouped review-created task, check that the combined task still has one clear stopping point, one coherent proof story, and no finding that was grouped only because it shares a repository or likely implementer.
38. Do not repair fragmentation by absorbing work into pre-existing non-review-created story tasks. Keep the findings response self-contained inside the new appended review-created block.
39. If the required findings-present plan mutations are still missing after your first edit, keep editing the plan in this same step until those mutations exist on disk. Do not leave a findings-present review pass encoded only in review artifacts.
40. When the findings artifact communicates no actionable findings after a complete review, re-open the plan after editing and verify that the no-findings path for the current `review_pass_id` is now present on disk as the required `Post-Implementation Code Review` section.
41. If a findings-present repair cannot honestly be made concrete in one pass, add bounded diagnostic review-fix tasks instead of leaving the plan unchanged. The flow must continue with executable task ownership rather than with un-tasked findings.
42. If the findings artifact is missing, unreadable, or ambiguous even after safe inference from the handoff and referenced artifacts, add a bounded incomplete-review follow-up task that names the missing context, the artifacts inspected, and the minimum evidence needed to complete the review. Do not create a no-findings close-out in that case.
43. If a runtime-config or local-stack cleanup whose exact `Scope Impact` is `cleanup_preference` would change known-working behavior and the artifacts do not prove a current defect, do not convert that cleanup into a review-created task. Preserve it as non-actionable or leave it for explicit user-approved follow-up instead.

</disposition_rules>

<review_task_shape_rules>

- Apply these rules whenever this step adds or rewrites substantive review-created follow-up tasks because findings are present. The dedicated final revalidation task follows `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md` instead.
- Keep runnable build, test, compose, and wrapper commands in each substantive task's automated-only `Testing` section.
- Keep each substantive task's `Subtasks` section for implementation work, proof-authoring work, exact proof-file citations, markers, fixtures, harness surfaces, screenshot path conventions, and other work that can be completed before formal proof runs.
- In substantive tasks, allow execution commands to remain in `Subtasks` only when the task is specifically creating, repairing, or proving a harness or wrapper itself. The dedicated final task's per-repository lint and formatting checklist is the explicit exception.
- Do not create manual testing checklist items in `Subtasks` or `Testing`.
- Do not create subtasks that depend on future automated or manual proof output in order to become complete.
- Place optional manual-testing-agent browser scenarios only in `Manual Testing Guidance`.
- Add `Manual Testing Guidance` only when the reviewed fix changes a browser-visible, runtime-visible, or otherwise externally observable surface that would benefit from optional manual-testing-agent validation.
- If the active plan explicitly names design-target assets intended as implementation references and the reviewed fix changes a browser-visible surface, use `Manual Testing Guidance` to require screenshot-to-design comparison on the repaired surface rather than screenshot capture alone.
- If the active plan explicitly names design-target assets intended as implementation references and the review-created final revalidation task changes or revalidates browser-visible surfaces, use that final task's `Manual Testing Guidance` to request story-wide screenshots for all implemented frontend surfaces that can honestly be exercised in the story, not only the most recent local fix surface.
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
  - append `Post-Implementation Code Review` when there are no findings;
  - add a bounded incomplete-review follow-up task when the review outcome remains unclear after safe inference.
- If this review mutates plans, commit only the resulting plan and code changes. Do not include the scratch review artifacts in the commit history.
- Do not finish this step while the stored review handoff and the canonical plan disagree about whether actionable findings exist, unless the handoff outcome remains unclear after safe inference and the plan now records a bounded incomplete-review follow-up task.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff and review handoff still match the current repository state.
- Confirm the review handoff or safely inferred context identifies the local-HEAD-vs-resolved-base comparison for every repository in scope.
- Confirm every affected repository has been reflected correctly in the canonical plan updates with explicit repository ownership.
- Confirm cross-repository findings produced explicit sequencing in the canonical plan and final validation.
- Confirm no allowed support file was reopened for anything other than spelling, grammar, wording, or an explicit secret/artifact-hygiene correction.
- Confirm the no-findings path, if used, explicitly recorded acceptance proof and residual risk across all repositories in scope.
- Confirm the no-findings path, if used, explicitly recorded any `local_fallback` review base and why remote review was unavailable.
- Confirm the no-findings path, if used, explicitly recorded generic adversarial proof or residual risk across all repositories in scope.
- Confirm the no-findings path, if used, carried forward sibling-scan or checked-defect-family reasoning from the saturation artifact when present, or from the findings artifact when the saturation artifact was absent.
- Confirm the no-findings path, if used, carried forward rejected-risk reasoning from the findings artifact and challenge artifact when present.
- Confirm scratch review artifacts are treated as local-only workflow files, the current-plan handoff is not mistaken for the review handoff, and the review handoff remains transient workflow state rather than a commit-worthy repository artifact.
- Confirm that a findings-present pass left new review-created `__to_do__` tasks plus a final revalidation task in the plan, or that a no-findings pass left the required `Post-Implementation Code Review` section for the current `review_pass_id`.
- Confirm that the fresh final revalidation task explicitly states that it revalidates the whole story plus the current review-created findings block for this `review_pass_id`, has only each worked-on repository's supported lint and formatting initial subtask types with unsupported commands omitted, and owns each such repository's full build, applicable startup, every relevant full suite, matching shutdown, supported lint, and supported formatting testing sequence.
- Confirm that any findings-present pass kept `Testing` automated-only, used `Manual Testing Guidance` only as optional non-blocking guidance, and did not create subtasks that depend on future automated or manual proof output.
- If the active plan explicitly names design-target assets intended as implementation references, confirm that any visual mismatch findings or comparison-proof gaps were either turned into review-created tasks or explicitly ruled out by direct screenshot-to-design comparison evidence when both the named design assets and usable retained screenshots existed.
- If screenshots or design assets were absent, confirm no review-created task was added solely for that absence.

</verification_loop>
