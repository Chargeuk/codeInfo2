# Goal

Classify the current review outcome into a machine-readable flow-state file for the review loop.

This step is a traffic controller only. It must not fix findings, task up findings, or mutate the canonical plan.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact canonical plan from disk before classifying the review, using explicit shell reads such as `sed`, `cat`, or `rg`.
- Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Do not discover review artifacts by timestamp.
- Use the stored review handoff plus the artifacts it references as the sole source of review outcome.
- Interpret the review handoff semantically rather than as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the referenced artifacts, current-plan handoff, and current git state to infer only the minimum safe meaning.
- If the review outcome cannot be interpreted safely, write an incomplete-review state instead of claiming no findings.
- Do not edit the canonical plan, review artifacts, code, tests, docs, or configuration in this step.
- The only file this step may create or update is `codeInfoStatus/flow-state/review-disposition-state.json`.
- Treat `codeInfoStatus/flow-state/review-disposition-state.json` as generated flow state. Do not commit it unless a later human explicitly asks to persist runtime state.

</critical_rules>

<prompt_quality_rules>

- Be explicit about what you read, how you classified the findings, and which state fields were set.
- Prefer structured output over prose when recording decisions.
- Use verification loops: after writing the state file, re-open it and confirm it is valid JSON and matches the review outcome you just classified.
- Do not rely on memory from previous turns. Use fresh disk reads and current git state. Do not answer from conversational memory or an earlier snapshot when the files can be re-read from disk now.
- When uncertain whether a finding is safe to fix inline as minor, classify it as task-required.

</prompt_quality_rules>

<scope_rules>

1. Read `codeInfoStatus/flow-state/current-plan.json` from disk, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
2. Extract `plan_path` and `additional_repositories`. If `additional_repositories` is missing, treat it as none.
3. Re-open the exact relative `plan_path` from disk using explicit shell reads such as `sed`, `cat`, or `rg`.
4. Verify the plan exists and that the current repository branch story number matches the story number in the selected plan filename.
5. Verify every additional repository path still exists, is readable, and is on a branch whose story number matches the selected plan filename.
6. Read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
7. Read the `findings_file` referenced by the review handoff directly from disk, for example with `cat <findings_file>`, or safely infer it from the handoff and artifact naming only when necessary.
8. Read `saturation_file` and `challenge_file` when present or safely inferable. Treat them as additive context, not as replacements for the findings artifact.
9. Read the previous `codeInfoStatus/flow-state/review-disposition-state.json` from disk when it exists, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`. Preserve prior minor-fix loop history only when it clearly belongs to the same story and same canonical plan.

</scope_rules>

<classification_rules>

- Classify every endorsed finding from the findings artifact into exactly one of:
  - `unresolved_task_required_findings`
  - `unresolved_minor_batchable_findings`
  - `resolved_minor_findings`
  - `rejected_or_non_actionable_findings`
  - `incomplete_review_blockers`
- Do not classify a finding as task-required solely because the finding description uses words such as `contract`, `route`, `user-visible`, `restart`, or `metadata ordering`.
- Prefer the minor path for bounded same-repository findings unless a hard no-inline rule is clearly triggered.
- Do not classify a finding as task-required solely because the finding description says the code is contract-sensitive, queue-sensitive, concurrency-sensitive, lifecycle-sensitive, or shared-caller-sensitive.
- Treat `must_fix` findings as findings that must be resolved in this story, not as automatically task-required. A `must_fix` finding may still be classified as minor-batchable when it satisfies every minor-batchable rule below.
- Treat `should_fix` findings as minor-batchable when every minor-batchable rule below is satisfied. Otherwise classify them as task-required.
- Treat `optional_simplification` findings as rejected or non-actionable unless the finding is concrete, localized, low-risk, and explicitly worth fixing in the current story. If it is worth fixing and satisfies every minor-batchable rule, classify it as minor-batchable. Otherwise classify it as task-required only when the review artifact makes it blocking.
- Treat incomplete-review outcomes, missing required artifacts, unreadable artifacts, stale scope, or ambiguous review basis as `incomplete_review_blockers`.
- When the findings artifact and handoff counts disagree, trust the findings artifact and record the mismatch in `classification_notes`.

</classification_rules>

<minor_batchable_rules>

A finding is minor-batchable only when all of these are true:

- It has one clear implementation owner repository, even if broader later validation may span other affected repositories.
- It is low-risk and small enough to attempt directly without splitting or planning a multi-step implementation sequence.
- It has a clear, bounded code/config/docs/test edit path, or a small combination of those, within the owning repository.
- It does not change, redefine, or reinterpret a public API, OpenAPI schema, persistence schema, queue contract, model shape, shared protocol, user-visible workflow contract, or destructive public authority boundary. Restoring parity with an already intended same-repository contract may still be minor-batchable when the rest of these rules are satisfied.
- It does not require broad refactoring, migration, state-machine redesign, lifecycle reordering, or new architecture.
- It is not ambiguous, disputed, blocked on missing capability, or dependent on another unimplemented finding.
- It can be checked with bounded local automated proof in the owning repository, including a small test update or one or two new focused tests when needed.
- Broader cross-repository proof and later manual testing may be deferred to the final revalidation task and do not by themselves disqualify an otherwise bounded finding from the minor path.
- Cross-surface error-classification or error-mapping findings are task-required by default.
- Exception: classify a cross-surface error-classification or error-mapping finding as minor-batchable only when all of these are clearly true:
  - The intended error or result contract is already clearly established elsewhere in the same repository.
  - The reviewed finding is a bounded outlier path that is merely failing to follow that already-established same-repository contract.
  - The repair is likely limited to one clear seam, such as one helper, one route, one service branch, or one caller catch/mapping path, plus one or two focused tests.
  - The fix does not require choosing between competing public contracts, redefining the meaning of an existing error code, or coordinating multiple surfaces that currently disagree in a materially different way.

Useful examples:

- A deferred replay path restoring the same required-field validation already enforced at admission may still be minor-batchable.
- Reordering a route's bounded same-repository checks so the stronger already-intended target-owned contract wins over a generic fallback may still be minor-batchable.
- Aligning one service function so it returns an already-established structured error instead of throwing may still be minor-batchable when the intended contract is already settled in the same repository.
- Moving malformed-input validation ahead of dependency I/O in one function may still be minor-batchable when it restores an already-established `INVALID_PARAMS`-style contract and remains bounded to one seam plus focused tests.
- A bounded producer-consumer alignment fix in one same-repository service/helper seam may still be minor-batchable when one path is failing to follow an already-established returned-result contract.
- Removing dead or unreachable fallback branches from a queue, lifecycle, or concurrency-sensitive helper may still be minor-batchable when the live-state or query contract already proves the branch cannot execute and the change can be checked with focused proof.
- Tightening or redefining a destructive route's public selector semantics before delete authority is exercised is not minor-batchable.
- Reinterpreting a shared error taxonomy across multiple callers or surfaces is not minor-batchable.

If any rule is not clearly satisfied, classify the finding as task-required.

</minor_batchable_rules>

<state_schema>

Write `codeInfoStatus/flow-state/review-disposition-state.json` with this JSON shape:

```json
{
  "schema_version": 1,
  "generated_at_utc": "<ISO-8601 UTC timestamp>",
  "story_number": "<story number from plan_path>",
  "plan_path": "<canonical plan path>",
  "review_cycle_id": "<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>",
  "review_handoff_path": "codeInfoTmp/reviews/<story-number>-current-review.json",
  "review_pass_id": "<review pass id or null>",
  "evidence_file": "<path or null>",
  "findings_file": "<path or null>",
  "saturation_file": "<path or null>",
  "challenge_file": "<path or null>",
  "repositories": [
    {
      "name": "<repo alias or path label>",
      "path": "<absolute or repo-relative path>",
      "branch": "<current branch>",
      "head": "<current HEAD short or full sha>",
      "comparison_base_ref": "<stored or inferred ref or null>",
      "comparison_base_commit": "<stored or inferred commit or null>",
      "comparison_head_ref": "<stored or inferred head ref or null>",
      "comparison_rule": "<stored or inferred rule or null>",
      "resolved_base_source": "<remote|local_fallback|unknown|null>",
      "remote_fetch_status": "<stored status or null>",
      "local_fallback_reason": "<stored sanitized reason or null>"
    }
  ],
  "unresolved_task_required_findings": [
    {
      "id": "<finding id>",
      "severity": "<must_fix|should_fix|optional_simplification|incomplete_review>",
      "repository": "<repository owner>",
      "summary": "<short summary>",
      "reason": "<why this needs task-up>"
    }
  ],
  "unresolved_minor_batchable_findings": [
    {
      "id": "<finding id>",
      "severity": "<must_fix|should_fix|optional_simplification>",
      "repository": "<repository owner>",
      "summary": "<short summary>",
      "reason": "<why this is safe for inline minor fixing>"
    }
  ],
  "resolved_minor_findings": [
    {
      "id": "<finding id>",
      "repository": "<repository owner>",
      "summary": "<short summary>",
      "resolution_commit": "<exact full 40-character git commit SHA or null>",
      "proof": "<proof summary or null>"
    }
  ],
  "rejected_or_non_actionable_findings": [
    {
      "id": "<finding id or note id>",
      "summary": "<short summary>",
      "reason": "<why no task or minor fix is needed>"
    }
  ],
  "incomplete_review_blockers": [
    {
      "id": "<blocker id>",
      "summary": "<missing artifact/context>",
      "minimum_evidence_needed": "<what is needed to proceed>"
    }
  ],
  "counts": {
    "unresolved_task_required": 0,
    "unresolved_minor_batchable": 0,
    "resolved_minor": 0,
    "rejected_or_non_actionable": 0,
    "incomplete_review_blockers": 0
  },
  "has_unresolved_task_required_findings": false,
  "has_unresolved_minor_batchable_findings": false,
  "only_minor_batchable_findings": false,
  "needs_minor_fix_path": false,
  "needs_task_up_path": false,
  "minor_fixes_made_in_review_loop": false,
  "minor_fix_commit_shas": [],
  "minor_fix_revalidation_cycle_closed": false,
  "final_revalidation_owned_by_task_up_path": false,
  "task_up_owned_final_revalidation_task_title": null,
  "needs_review_rerun_before_close": false,
  "needs_final_minor_fix_revalidation_task": false,
  "review_created_tasks_added_or_updated": false,
  "safe_to_exit_review_loop_without_tasking": false,
  "classification_notes": []
}
```

</state_schema>

<state_field_rules>

- `has_unresolved_task_required_findings` is true when `unresolved_task_required_findings` or `incomplete_review_blockers` is non-empty.
- `has_unresolved_minor_batchable_findings` is true when `unresolved_minor_batchable_findings` is non-empty.
- `only_minor_batchable_findings` is true only when there is at least one unresolved minor-batchable finding and no unresolved task-required finding or incomplete-review blocker.
- `needs_minor_fix_path` is true whenever unresolved minor-batchable findings remain, even when task-required findings or incomplete-review blockers already exist from earlier minor-fix attempts in the same review cycle.
- `needs_task_up_path` is true when unresolved task-required findings or incomplete-review blockers exist.
- Any populated `resolution_commit` or `minor_fix_commit_shas` value must be an exact full 40-character git commit SHA, not a short SHA and not a guessed expansion.
- `reset_review_cycle_state.md` runs before every fresh `Review Findings Disposition Loop`, so any previous state that still exists here should be treated as same-active-loop carry-forward only.
- `review_cycle_id` must use the format `<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>`.
- `review_cycle_id` must stay stable for one active review loop. Preserve it only when the previous state clearly belongs to the same still-active review loop for the same story and same canonical `plan_path`. Otherwise mint a fresh cycle id when writing new classifier state.
- `minor_fixes_made_in_review_loop`, `minor_fix_commit_shas`, `resolved_minor_findings`, `minor_fix_revalidation_cycle_closed`, `final_revalidation_owned_by_task_up_path`, and `task_up_owned_final_revalidation_task_title` should be preserved from the previous state only when they clearly belong to the same still-active review loop for the same story and plan. Otherwise initialize them as empty, null, or false.
- Do not try to close a new review cycle by scanning the canonical plan for an older completed final revalidation task from an earlier cycle. Fresh review-loop starts are separated by `reset_review_cycle_state.md`.
- `needs_review_rerun_before_close` is true when minor fixes have been made and the current review pass has not yet proven a clean or task-required follow-up state for the new HEAD.
- `needs_final_minor_fix_revalidation_task` is true only when minor fixes have been made, the current review pass has no unresolved findings or incomplete-review blockers, `minor_fix_revalidation_cycle_closed` is not true, and `final_revalidation_owned_by_task_up_path` is not true.
- `review_created_tasks_added_or_updated` must remain false in this classifier step. Later task-up or final-revalidation steps may update it.
- `safe_to_exit_review_loop_without_tasking` is true only when no unresolved task-required findings, no unresolved minor-batchable findings, no incomplete-review blockers, no needed review rerun, and no needed final minor-fix revalidation task remain.

</state_field_rules>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop without writing a misleading clean state and say the current-plan handoff must be regenerated.
- If the canonical plan file is missing or the current repository branch story number does not match the selected plan filename, stop and say the current-plan handoff is stale and must be regenerated.
- If any additional repository is missing, unreadable, or on a branch whose story number does not match the selected plan filename, stop and say repository branch scope has drifted and must be repaired before continuing.
- If the review handoff or findings artifact is missing, unreadable, or malformed but enough story context exists to write state, write an `incomplete_review_blockers` entry and set `needs_task_up_path` true.
- If a previous state file is malformed, ignore its carry-forward fields, add a `classification_notes` entry, and continue from the current review artifacts when they are usable.
- If a finding cannot be parsed into a stable ID, assign a deterministic local ID such as `unparsed-1` and record the parsing limitation in `classification_notes`.

</failure_modes>

<output_contract>

- Create or update only `codeInfoStatus/flow-state/review-disposition-state.json`.
- Report:
  - the review pass classified;
  - counts for task-required, minor-batchable, resolved-minor, rejected/non-actionable, and incomplete-review items;
  - whether the next path should be minor-fix, task-up, final minor-fix revalidation, review rerun, or clean exit.
- Do not claim findings were fixed or tasked up in this step.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before any other flow-state file.
- Confirm the exact canonical plan was re-opened from disk.
- Confirm the review handoff and referenced findings artifact were read.
- Confirm every endorsed finding was classified into exactly one state bucket.
- Confirm uncertain findings were classified as task-required rather than minor.
- Confirm any carry-forward state you preserved came from the same still-active review loop rather than an earlier completed review cycle.
- Confirm `review_cycle_id` is present and belongs to the active review loop you just classified.
- Confirm you did not treat an older completed final revalidation task in the canonical plan as proof that a fresh new review cycle was already closed.
- Confirm the state file is valid JSON after writing.
- Confirm the state counts match the arrays in the state file.
- Confirm this step did not edit the canonical plan, review artifacts, code, tests, docs, or config.

</verification_loop>
