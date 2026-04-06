# Goal

Repair the canonical plan so the stored review outcome is definitely encoded into executable plan state before downstream review-task enhancement continues.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact canonical plan from disk before making any decision.
- Derive the story number from the stored `plan_path`, then read `codeInfoStatus/reviews/<story-number>-current-review.json`.
- Use the stored review handoff plus the artifacts it references as the sole source of review outcome for this step.
- Do not fail this step because a previous disposition pass underperformed. Repair the plan instead.
- Do not rediscover the story, review pass, or review comments independently.

</critical_rules>

<scope_rules>

1. Validate that the stored handoff plan exists and that the current repository branch story number still matches the selected plan filename.
2. Validate that every additional repository in scope still exists, is readable, and remains on a branch whose story number matches the selected plan filename.
3. Read the stored review handoff and confirm that its `story_id`, `plan_path`, `review_pass_id`, `evidence_file`, `findings_file`, and repository scope still match the current handoff scope and repository state.
4. Read the findings artifact referenced by the review handoff. Read the challenge artifact when present.
5. Re-open the canonical plan from disk immediately before deciding whether repair is needed.

</scope_rules>

<decision_rules>

1. If `finding_counts.must_fix + finding_counts.should_fix > 0`, the plan must visibly encode that review outcome on disk before this step finishes.
2. A findings-present plan is considered correctly encoded only when all of the following are true:
   - the plan contains a new `Code Review Findings` section for the current `review_pass_id`;
   - the plan contains at least one newly added review-created `Task Status: __to_do__` task after that section;
   - the plan contains a fresh final re-test or revalidation task after those new review-fix tasks;
   - each new task names exactly one repository and follows the existing task structure.
3. If `finding_counts.must_fix + finding_counts.should_fix == 0`, the plan must instead contain the required no-findings close-out for the current `review_pass_id`.
4. If the current plan already satisfies the correct postcondition for the stored review outcome, make no plan change.
5. If the plan does not satisfy the correct postcondition, repair it in this step instead of reporting the gap and stopping.

</decision_rules>

<repair_rules>

1. When findings are present and the plan is missing review-fix tasks, add them directly to the end of the canonical plan in the repository's existing review-task format.
2. Add one or more review-fix tasks that respond to the endorsed findings in the findings artifact, with explicit repository ownership, subtasks, proof homes, and wrapper-first testing.
3. Add a fresh final re-test or revalidation task after the new review-fix tasks so the story cannot close without re-running proof.
4. Keep the repair concrete and executable by a junior developer. If a finding is still too unclear for a direct code-change task, create a bounded diagnostic task with an explicit stopping rule rather than leaving the finding un-tasked.
5. When no findings are present and the required close-out section is missing, append the required `Post-Implementation Code Review` section for the current `review_pass_id`.
6. After repairing the plan, re-open it from disk and verify that the required postcondition now exists before finishing this step.

</repair_rules>

<behavior_rules>

- Prefer deterministic checks based on the stored review handoff, the findings file, and the on-disk plan state.
- Do not treat artifact capture, support-file wording cleanup, or unrelated plan polish as sufficient when the stored review handoff still says actionable findings are present.
- Do not broaden scope beyond encoding the stored review outcome honestly into the canonical plan.
- If a previous disposition pass added only partial review text without executable tasks, keep that text only when it remains accurate and then add the missing tasks after it.

</behavior_rules>

<output_contract>

- Leave the canonical plan in a state that matches the stored review outcome:
  - findings present => review-fix tasks plus final revalidation task;
  - no findings => required post-review close-out section.
- Make no plan changes only when the current plan already satisfies the correct postcondition.

</output_contract>

<verification_loop>

- Confirm you re-read `current-plan.json` first.
- Confirm you re-opened the exact canonical plan from disk before deciding whether repair was needed.
- Confirm you read the stored review handoff and findings artifact for the same story.
- Confirm that a findings-present handoff did not leave the plan without new review-created `__to_do__` tasks and a final revalidation task.
- Confirm that a no-findings handoff did not leave the plan without the required close-out section.
- Confirm the repaired plan now matches the stored review outcome on disk.

</verification_loop>
