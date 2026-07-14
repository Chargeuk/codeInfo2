# Goal

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/review-wave-consumer-contract.md` first and filter the aggregated wave findings without losing target ownership.

Filter the classified review findings so only current-story in-scope findings remain actionable.

This step is an explicit scope gate only. It must not fix findings, task up findings, mutate the canonical plan, or widen story scope.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` before filtering any finding.
- Read `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"` and follow it strictly.
- Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk using explicit shell reads such as `cat`, `sed`, or `rg` whenever review-handoff context is needed. Read the `findings_file` referenced by that handoff from disk before relying on its review evidence.
- Use the stored review handoff plus the artifacts it references only when needed to verify whether a finding is in scope. Do not rediscover review artifacts by timestamp.
- Do not edit the canonical plan, code, tests, docs, or configuration in this step.
- The only file this step may create or update is `codeInfoStatus/flow-state/review-disposition-state.json`.
- Treat `codeInfoStatus/flow-state/review-disposition-state.json` as generated flow state. Do not commit it unless a later human explicitly asks to persist runtime state.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.

</critical_rules>

<scope_rules>

1. Read `codeInfoStatus/flow-state/current-plan.json` from disk and extract `plan_path` and `additional_repositories`. If `additional_repositories` is missing, treat it as none.
2. If `current-plan.json` is missing, unreadable, malformed, or does not name a usable canonical `plan_path`, make no edits and treat this step as a clean skip for the current pass.
3. Use the fresh bounded review-scope packet for the exact relative `plan_path`.
4. If the canonical plan is missing, unreadable, or unusable, make no edits and treat this step as a clean skip for the current pass.
5. Verify the current repository branch story number matches the story number in the selected plan filename. If it does not match, make no edits and treat this step as a clean skip for the current pass.
6. Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk and treat it as the only actionable-routing input for this step.
7. If `review-disposition-state.json` is missing, unreadable, malformed, or unusable, make no edits and treat this step as a clean skip for the current pass.
8. Preserve all non-finding routing metadata in the state file unless this step must update it to reflect filtered findings honestly.
9. Read `codeInfoTmp/reviews/<story-number>-current-review.json` and the `findings_file` it references only when needed to determine whether a finding is story-introduced, story-regressive, explicitly required, or pre-existing.
10. Treat the current review handoff and its referenced findings artifact as optional evidence inputs, not required routing inputs.
11. If the review handoff or referenced findings artifact is missing, unreadable, or unusable, do not guess from memory or rediscover by timestamp. Do not newly reject a finding solely because that optional evidence is unavailable. Keep the finding unchanged unless a safe rejection or narrowing decision can still be made from the canonical plan and current review disposition state alone.

</scope_rules>

<filter_purpose>

- Start with every finding currently placed in actionable buckets.
- Pass each actionable finding through every rejection gate below.
- A finding must survive every rejection gate to remain actionable.
- If a finding fails any rejection gate, remove it from actionable buckets and place it into `rejected_or_non_actionable_findings`.
- If a finding mixes an in-scope issue with an out-of-scope proposed fix, keep only the in-scope core issue, rewrite it narrowly, and record that narrowing in the finding rationale.
- Do not create new findings in this step.
- Do not create new implementation tasks in this step.

</filter_purpose>

<rejection_gates>

Reject a finding if any of the following are true.

1. The finding is explicitly listed in the plan's `### Out Of Scope` section.
2. The finding is clearly implied to be out of scope by the plan's `### Out Of Scope` section.
3. The proposed work would conflict with the plan's `### Acceptance Criteria`.
4. The proposed work would expand, redirect, or materially change the agreed scope of the story.
5. The issue already existed before the story began and fixing it is not explicitly part of the story.
6. The finding is not caused by:
   - the story's new code;
   - a regression the story caused in existing code;
   - a missing feature, requirement, proof item, or testing item that the story explicitly needs.
   - Being in the same changed file is not enough by itself.
   - Being in the same subsystem is not enough by itself.
   - Being nearby, adjacent, or generally related behavior is not enough by itself.
   - A finding in pre-existing code is only in scope if the story changed that exact behavior seam, or the canonical plan explicitly requires preserving or restoring that seam.
7. The finding would change user-facing behavior that was not explicitly requested by the story or later explicitly approved by the user.
8. The finding is really asking for a cleaner design, broader compatibility, refactor, hardening, portability improvement, polish improvement, or general product improvement that the story did not request.
9. The reviewer's suggested fix is out of scope, even if the underlying observation is generally reasonable, and there is no narrower in-scope version of the finding to preserve.
10. There is not enough evidence to show that the finding is:
    - story-introduced;
    - story-regressive;
    - explicitly required by the story;
    - or a restoration of previously approved or preserved behavior.

</rejection_gates>

<required_non_rejection_rule>

- Do not reject a finding merely because it changes current branch behavior if the finding restores previously approved or preserved behavior that the story accidentally drifted away from.
- That restoration is current-story scope.

</required_non_rejection_rule>

<authoritative_findings_rule>

- Only findings with stable IDs in the canonical actionable review state may create immediate implementation scope in the current story.
- Challenge notes, saturation notes, evidence notes, or other review prose may surface potentially real issues, but they are advisory only until they are materialized into the canonical findings state with a stable ID and final disposition basis.
- Being mentioned in the same review cycle is not enough by itself.
- Being present in a challenge, saturation, or evidence artifact is not enough by itself.
- If a secondary review artifact appears to promote an extra issue that is not yet canonicalized, implementation must not start from that prose alone.
- Instead, preserve or create a single artifact-reconciliation blocker or explicit follow-up capture note, and stop scope expansion there until the canonical findings state is reconciled.
- This rule must prevent silent scope expansion, but must not require the issue to be ignored forever merely because it first appeared in a secondary review artifact.

</authoritative_findings_rule>

<ambiguity_rules>

- If scope is ambiguous, prefer rejection over scope expansion.
- Do not keep a finding actionable by giving it the benefit of the doubt.
- If evidence is incomplete because optional review artifacts are unavailable, do not newly reject on that basis alone. Keep the finding unchanged unless a safe rejection or narrowing decision can still be made from the canonical plan and current review disposition state alone.
- If evidence is incomplete even though the core routing inputs are present and usable, and the remaining authoritative evidence still does not prove in-scope status, move the finding to `rejected_or_non_actionable_findings` and explain that in-scope status was not proven.

</ambiguity_rules>

<follow_up_capture_rule>

- When rejecting a finding as pre-existing, broader than story scope, or otherwise non-actionable for the current story, state whether it should be ignored for this story only or captured as separate follow-up work outside the current story.
- Rejected issues must not remain alive as review-loop blockers, task-up candidates, or actionable findings just because they might still deserve later follow-up.
- If the issue may still deserve later follow-up, that follow-up must be recorded separately from the current story's actionable findings and must not silently preserve implementation scope in the current story.

</follow_up_capture_rule>

<full_state_coherence_rules>

- Treat this step as a full review-state rewrite for routing purposes, not as a partial bucket edit.
- After filtering findings, recompute every derived field in `review-disposition-state.json` that depends on finding buckets or review-loop closure state.
- Do not leave stale booleans, stale counts, or stale loop-routing flags behind after moving, rejecting, or narrowing findings.
- Preserve same-cycle fields that this step does not own semantically, but verify that any preserved field still remains consistent with the filtered findings state.
- Preserve the classifier's current-pass `review_decision_recording` object unchanged. It must remain `pending` until the later recorder or verifier replaces it; this filtering step must never remove it or claim recording succeeded.

At minimum, after any filtering change, recompute or revalidate all of the following:

- `counts`
- `has_unresolved_task_required_findings`
- `has_unresolved_minor_batchable_findings`
- `only_minor_batchable_findings`
- `needs_minor_fix_path`
- `needs_task_up_path`
- `needs_review_rerun_before_close`
- `needs_final_minor_fix_revalidation_task`
- `safe_to_exit_review_loop_without_tasking`

Preserve unless inconsistency requires repair:

- `review_cycle_id`
- `minor_fixes_made_in_review_loop`
- `minor_fix_commit_shas`
- `resolved_minor_findings`
- `operationally_blocked_minor_findings`
- `incomplete_review_blockers`
- `minor_fix_revalidation_cycle_closed`
- `final_revalidation_owned_by_task_up_path`
- `task_up_owned_final_revalidation_task_title`
- `review_created_tasks_added_or_updated`

When preserving an existing same-cycle field, do not preserve it blindly. Verify it still agrees with the filtered findings state. If it no longer agrees, repair it to the minimum extent needed to restore honest loop routing.

When checking blocker-style state for consistency:

- Do not preserve an `incomplete_review_blocker` or `operationally_blocked_minor_finding` if it is tied only to a finding that this step rejected or narrowed out of its previous actionable contract.
- If a blocker or blocked-minor entry still has a valid in-scope core issue after filtering, narrow that blocker entry so it describes only the remaining in-scope condition.
- Remove or reclassify any blocker entry that no longer has a surviving actionable finding, surviving in-scope blocker condition, or other current-cycle routing basis after filtering.

Never leave the state in a shape where:

- `needs_minor_fix_path` is false while unresolved minor findings still remain.
- `needs_task_up_path` is false while unresolved task-required findings or incomplete-review blockers still remain.
- `safe_to_exit_review_loop_without_tasking` is true while any unresolved findings, blocked minor findings, rerun requirement, or final revalidation requirement still remains.
- `needs_task_up_path` remains true only because an `incomplete_review_blocker` tied solely to a rejected finding was preserved.
- `safe_to_exit_review_loop_without_tasking` remains false only because a blocker tied solely to a rejected finding was preserved.
- downstream loop-control scripts would decide the review loop can finish cleanly only because stale state was preserved.

</full_state_coherence_rules>

<state_update_rules>

- Rewrite `unresolved_task_required_findings` so it contains only findings that survived every rejection gate.
- Rewrite `unresolved_minor_batchable_findings` so it contains only findings that survived every rejection gate.
- Preserve `resolved_minor_findings` exactly as it already stands unless a state-consistency repair is required.
- Preserve `operationally_blocked_minor_findings` and `incomplete_review_blockers` only when each preserved entry still matches a surviving actionable finding or other surviving current-cycle blocker basis after filtering.
- Narrow or remove any `operationally_blocked_minor_findings` or `incomplete_review_blockers` entry whose prior contract depended on a finding that this step rejected or narrowed out of its previous actionable form.
- Preserve existing `rejected_or_non_actionable_findings` entries and append newly rejected findings there.
- For every finding rejected by this step, record:
  - the original finding id;
  - a short summary;
  - the rejection gate number;
  - a concise explanation tied to the plan and story scope;
  - whether the finding was rejected entirely or narrowed before reclassification.
- If a finding is narrowed to keep only an in-scope core issue, update its actionable-bucket entry so the remaining work is explicitly within scope and explain the narrowing in its `reason`.
- Recompute all counts and derived booleans so they match the filtered state exactly.
- Do not clear or fabricate unrelated state fields.

</state_update_rules>

<output_contract>

- Leave `codeInfoStatus/flow-state/review-disposition-state.json` in a state where downstream steps can trust that this step removed or narrowed every finding it could safely determine to be out of scope, and did not newly reject findings solely because optional review evidence was unavailable.
- If the step clean-skips because `current-plan.json`, the canonical plan, or `review-disposition-state.json` is missing or unusable, make no edits to `review-disposition-state.json`.
- When optional review evidence is unavailable, any unchanged actionable finding must be understood as preserved pending stronger evidence, not as newly re-verified by this step.
- If optional review evidence inputs are unavailable, leave any evidence-dependent findings unchanged unless a safe rejection or narrowing decision can still be made from the canonical plan and current review disposition state alone.
- Do not invent new findings, new tasks, new scope, or new product decisions.
- If the step did not clean-skip, stop once every actionable finding has either:
  - survived all rejection gates and remained actionable;
  - been narrowed to an in-scope core issue;
  - or been moved to `rejected_or_non_actionable_findings`.
- If the step clean-skipped because required routing inputs were unavailable or mismatched, stop after making no edits.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before `review-disposition-state.json`.
- Confirm a fresh bounded review-scope packet was loaded before filtering findings.
- Confirm `story_behavior_lock.md` was read and applied.
- Confirm that if `current-plan.json`, the canonical plan, or `review-disposition-state.json` was missing or unusable, the step made no edits and clean-skipped the current pass.
- Confirm that if the current branch story number did not match the selected plan filename, the step made no edits and clean-skipped the current pass.
- Confirm every actionable finding was evaluated against all rejection gates.
- Confirm no rejected finding remained in an actionable bucket.
- Confirm every newly rejected finding records the gate number and explanation.
- Confirm any narrowed finding now describes only the in-scope core issue.
- Confirm that missing optional review evidence did not by itself cause any new finding rejection.
- Confirm the step did not claim to newly verify any unchanged evidence-dependent finding when optional review artifacts were unavailable.
- Confirm no `incomplete_review_blocker` or `operationally_blocked_minor_finding` remains solely because a rejected finding used to justify it.
- Confirm the stop condition matched the actual path taken: full finding filtering on a normal pass, or no-edit exit on a clean-skip pass.
- Confirm counts and derived booleans in `review-disposition-state.json` match the filtered arrays.
- Confirm the filtered state would make the minor-fix path, task-up path, and outer review-loop exits route honestly if the loop-control scripts were run immediately after this step.
- Confirm the updated state file is valid JSON after writing.

</verification_loop>
