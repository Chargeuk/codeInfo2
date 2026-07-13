# Goal

Repair the current review cycle's newly added or updated review-created task block so every section stays within current-story scope before the flow returns to the main implementation loop.

This step is the final scope-repair authority for review-created tasks. It may repair the canonical plan in place, but it must not create code changes, run proof, widen story scope, or rewrite unrelated older tasks.

This step runs only after a separate loop preflight has already decided the task-scope audit context is safe enough to continue. Focus on repair work, not on re-deriving the loop's main clean-skip contract.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`, when it exists and is valid enough to supply current review-cycle context.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md` and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` immediately before making any decision.
- After making any repair edit, rerun the same bounded review-tasking query before deciding the repair is complete.
- Do not answer from conversational memory, prior loop passes, earlier summaries, or an earlier snapshot when the plan can be re-read from disk now.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"` strictly.
- Do not rediscover the story, review cycle, or review-created task block by timestamp alone.
- Do not edit code, tests, docs, flow-state JSON, review handoff files, or configuration in this step.
- The only file this step may update is the canonical plan selected by `current-plan.json`.

</critical_rules>

<scope_rules>

1. Read `codeInfoStatus/flow-state/current-plan.json` from disk and extract `plan_path` and `additional_repositories`. If `additional_repositories` is missing, treat it as none.
2. If `current-plan.json` is missing, unreadable, malformed, or does not name a usable canonical `plan_path`, make no plan edits and stop. The loop preflight should normally have already exited before this step ran.
3. Use the fresh bounded review-tasking packet for the exact relative `plan_path`.
4. If the canonical plan is missing, unreadable, or unusable, make no plan edits and stop. The loop preflight should normally have already exited before this step ran.
5. Verify the current repository branch story number matches the story number in the selected plan filename. If it does not match, make no plan edits and stop. The loop preflight should normally have already exited before this step ran.
6. Treat `review-disposition-state.json` and `codeInfoTmp/reviews/<story-number>-current-review.json` as review-cycle identification aids, not as substitutes for the canonical plan.
7. Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk when it exists and is valid enough to provide the active `review_cycle_id`, `review_pass_id`, and `task_up_owned_final_revalidation_task_title`.
8. Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`, whenever the current review handoff is needed to identify the active review-created block safely.
9. If both the review disposition state and the current review handoff are missing, unreadable, malformed, or otherwise unusable for active review-cycle identification, make no plan edits and stop. The loop preflight should normally have already exited before this step ran.
10. Inspect only the current review cycle's newly added or updated review-created task block. Do not rewrite older non-review-created tasks except for minimal numbering, dependency, or cross-reference repairs that are strictly required to keep the plan executable and truthful.

</scope_rules>

<review_created_block_identification_rules>

- Prefer `review-disposition-state.json` as the source of truth for the current review cycle.
- When `task_up_owned_final_revalidation_task_title` is present, use it to help identify the trailing boundary of the current review-created block.
- When a usable current review handoff or usable review-disposition state identifies the active `review_pass_id`, use that review pass id plus the nearest appended `Code Review Findings` section only to confirm the current review-created block boundary.
- Treat the current review-created block as the tasks for the active review cycle that were newly appended or updated in place, plus their shared final revalidation task when one exists, not as all tasks in the story.
- Use this fallback selector order when the active review-created block is not obvious from the state alone:
  1. tasks explicitly tied to the active `review_cycle_id`;
  2. tasks explicitly tied to the active `review_pass_id`;
  3. the review-created block directly associated with the nearest appended `Code Review Findings` section for the active review pass.
- Plan text may confirm an already identified active review cycle or active review pass, but it must not bootstrap the active review-created block by itself when both review-disposition state and current review handoff are unusable.
- Do not rewrite a task merely because it looks review-related. It must be tied to the active review cycle or active review pass by explicit plan text or active review-state metadata.
- If multiple plausible current-cycle blocks still remain after applying the selector order, make no plan edits and stop. The loop preflight should normally have already exited before this step ran.
- If the current review-created block still cannot be identified safely after applying the selector order, make no plan edits and stop. The loop preflight should normally have already exited before this step ran.

</review_created_block_identification_rules>

<section_scope_rules>

For each newly added or updated review-created task in the current review-created block, inspect and repair every relevant section that is present, including:

- task heading or title
- `Repository Name`
- `Task Dependencies`
- `Notes`
- `Overview`
- `Task Exit Criteria`
- `Addresses Findings`
- `Risk Ownership`
- `Owner Map`
- `Requirement-To-Proof Mapping`
- `Proof Mapping`
- `Affected Repositories`
- `Documentation Locations`
- `Subtasks`
- `Testing`
- `Manual Testing Guidance`
- `Implementation Notes`

Treat the whole task as in scope only when all relevant sections stay within approved current-story scope.

</section_scope_rules>

<rejection_gates>

Repair or narrow any review-created task content that fails one or more of these gates.

1. Reject or narrow content that is explicitly listed in the plan's `### Out Of Scope` section.
2. Reject or narrow content that is clearly implied to be out of scope by the plan's `### Out Of Scope` section.
3. Reject or narrow content that conflicts with the plan's `### Acceptance Criteria`.
4. Reject or narrow content that expands, redirects, or materially changes the agreed scope of the story.
5. Reject or narrow content that fixes a pre-existing unrelated bug, inconsistency, limitation, awkward workflow, or product issue that is not explicitly part of the story.
6. Reject or narrow content that introduces a user-facing behavior change that was not explicitly requested by the story or later explicitly approved by the user.
7. Reject or narrow content that broadens cleanup, refactor, redesign, compatibility, portability, hardening, or polish work beyond what is required for the current review-created finding.
8. Reject or narrow content that uses `Testing`, `Manual Testing Guidance`, `Requirement-To-Proof Mapping`, `Proof Mapping`, `Risk Ownership`, or `Implementation Notes` to smuggle in implementation or behavior scope that the finding itself did not justify.
9. Reject or narrow content that broadens `Affected Repositories`, `Owner Map`, or dependencies beyond the narrowest honest implementation and proof surface needed for the finding, except that the shared final revalidation task may name every affected repository and proof surface honestly required to validate the full current review-created findings block.
10. Reject or narrow content when the reviewer's preferred remedy was broader than allowed and the task wording silently turned that broader remedy into current-story scope instead of preserving the constrained in-scope fix.

</rejection_gates>

<required_non_rejection_rule>

- Do not reject a repair merely because it visibly changes current `HEAD` when the repair restores previously approved or preserved behavior that the current story accidentally drifted away from.
- That restoration remains in-scope current-story work.

</required_non_rejection_rule>

<repair_rules>

- Default to repairing review-created tasks in place rather than rejecting the whole block.
- Rerun the bounded review-tasking query and reread the review-cycle identification inputs immediately before editing. If the context became unusable after the loop preflight and before this repair step, make no plan edits and stop.
- If a section mixes valid in-scope work with out-of-scope work, keep the valid core and rewrite the section narrowly so it stays within story scope.
- Keep newly added review-created tasks concrete and executable by a junior developer.
- Preserve durable finding coverage in `Addresses Findings` or equivalent wording.
- Keep each review-created task to one clear implementation owner in `Repository Name`.
- Allow cross-repository proof only when the task honestly needs it; do not let proof ownership broaden implementation scope.
- Keep `Testing` automated-only and keep optional browser or runtime manual proof only in `Manual Testing Guidance`.
- Do not convert proof or test-harness needs into unrelated product work.
- If a task cannot be honestly narrowed in one pass without inventing a new product decision, preserve current approved behavior and narrow the task to the allowed current-story work only.
- If the block is already in scope, make no plan edit.

</repair_rules>

<prompt_quality_rules>

- Be explicit about which task numbers and sections were repaired.
- Prefer direct plan repair over advisory notes.
- Keep critical constraints above general explanation.
- Optimize for deterministic, outcome-first edits rather than open-ended commentary.
- If the current review-created block was identified safely, stop once that block is narrowed to honest current-story scope and the canonical plan on disk reflects that repaired state.
- If the context became unusable after the loop preflight and before or during this repair step, stop after making no plan edits.

</prompt_quality_rules>

<output_contract>

- When the current review-created task block was identified safely, leave the canonical plan in a state where that block is fully within current-story scope across all relevant sections.
- Make no edits outside the current review-created block except for minimal numbering, dependency, or cross-reference repairs required by those scope fixes.
- If the context became unusable after the loop preflight and before or during this repair step, make no plan edits and do not claim that the current review-created block was re-verified by this step.
- Do not create code changes.
- Do not create new review findings.
- Do not widen story scope.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read from disk first.
- Confirm `review-disposition-state.json` was read from disk after `current-plan.json` when it existed and was usable.
- Confirm a fresh bounded review-tasking packet was loaded immediately before making scope judgments.
- Confirm the bounded review-tasking packet was regenerated after any repair edits.
- Confirm only the current review cycle's newly added or updated review-created task block was substantively rewritten.
- Confirm that if the context became unusable after the loop preflight and before or during this repair step, the step made no plan edits and did not claim to re-verify the current review-created block.
- Confirm the stop condition matched the actual path taken: repaired in-scope block on a normal pass, or no-edit exit because the context changed after preflight.
- Confirm each repaired task was checked section-by-section rather than only through `Subtasks`.
- Confirm no repaired section now conflicts with `### Acceptance Criteria`, `### Out Of Scope`, or the story behavior lock.
- Confirm no repaired task silently broadened cleanup, compatibility, portability, hardening, or redesign work beyond the justified finding scope.
- Confirm no repaired task silently converts the reviewer's broader preferred remedy into current-story scope when a narrower in-scope fix is required instead.
- Confirm any visible behavior restoration that remains was preserved only because it restores previously approved or preserved behavior after current-story drift.

</verification_loop>
