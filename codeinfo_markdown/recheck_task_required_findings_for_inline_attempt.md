# Goal

Re-check the currently task-required review findings and move any clearly bounded same-repository repairs back into the inline minor-fix path before task-up begins.

This step is a second-chance classifier only. It must not edit code, tests, docs, config, review artifacts, or the canonical plan.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Then read `codeInfoStatus/flow-state/review-disposition-state.json` from disk, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Re-open the exact canonical plan from disk, using explicit shell reads such as `sed`, `cat`, or `rg`.
- Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Read the findings artifact referenced by the review handoff directly from disk when you need more context for a specific finding.
- Do not discover artifacts by timestamp.
- Do not edit the canonical plan, review artifacts, code, tests, docs, or configuration in this step.
- The only file this step may update is `codeInfoStatus/flow-state/review-disposition-state.json`.

</critical_rules>

<decision_rules>

1. Start from the existing `unresolved_task_required_findings` in `review-disposition-state.json`.
2. Do not keep a finding task-required solely because its writeup uses words such as `contract`, `route`, `user-visible`, `restart`, `metadata ordering`, or `must_fix`.
3. Move a task-required finding back into `unresolved_minor_batchable_findings` when all of these are true:
   - it has one clear implementation owner repository;
   - it is bounded to one route, helper, service area, or a similarly tight same-repository seam;
   - it does not require broad refactoring, lifecycle redesign, schema redesign, or architecture change;
   - it can likely be fixed with a small code change plus one or two focused tests;
   - it primarily restores parity with an already intended or already proven same-repository contract rather than inventing a new broader contract;
   - it does not tighten, loosen, or reinterpret a destructive public authority boundary.
4. Keep a finding in `unresolved_task_required_findings` when any of these are true:
   - it changes a destructive public selector or authority boundary;
   - it reinterprets a shared error taxonomy or caller-visible contract across multiple surfaces or callers;
   - the correct contract meaning is ambiguous;
   - it is likely to spread across several files, layers, or repositories;
   - it is not clearly bounded enough for one inline attempt.
5. Positive examples for moving back to minor:
   - deferred replay must enforce the same required-field validation contract as admission;
   - route check ordering must preserve a stronger already-intended target-owned error contract instead of a generic fallback.
6. Negative examples that should remain task-required:
   - a destructive route must stop accepting alias selectors before delete authority is exercised;
   - multiple callers disagree on a shared error-classification contract and the correct public outcome needs coordinated repair.
7. When uncertain, keep the finding task-required.

</decision_rules>

<state_update_rules>

- Rebuild `unresolved_task_required_findings` and `unresolved_minor_batchable_findings` from the rechecked outcome.
- Preserve all other buckets unless this step has a clear reason to move a finding between the two active unresolved buckets.
- Recompute:
  - `counts.unresolved_task_required`
  - `counts.unresolved_minor_batchable`
  - `has_unresolved_task_required_findings`
  - `has_unresolved_minor_batchable_findings`
  - `only_minor_batchable_findings`
  - `needs_minor_fix_path`
  - `needs_task_up_path`
  - `safe_to_exit_review_loop_without_tasking`
- Append `classification_notes` entries for every finding moved back to minor and every finding deliberately kept task-required.
- Do not clear `minor_fixes_made_in_review_loop`, `resolved_minor_findings`, `minor_fix_commit_shas`, `final_revalidation_owned_by_task_up_path`, or other same-loop carry-forward fields unless they are obviously invalid for the current story.

</state_update_rules>

<output_contract>

- Update only `codeInfoStatus/flow-state/review-disposition-state.json`.
- Report:
  - how many findings stayed task-required;
  - how many findings were moved back into the minor path;
  - whether the review loop should now continue inline fixing before task-up.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before `review-disposition-state.json`.
- Confirm the canonical plan was re-opened from disk.
- Confirm the review handoff remained the source of truth for the same story and review pass.
- Confirm no code, tests, docs, config, plan text, or review artifacts were edited.
- Confirm the updated state file is valid JSON.
- Confirm any finding moved back to minor satisfies every positive rule and no negative rule.
- Confirm any finding left task-required has an explicit reason recorded in `classification_notes`.

</verification_loop>
