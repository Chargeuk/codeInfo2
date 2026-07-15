# Goal

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/review-wave-consumer-contract.md` first and apply its wave-mode artifact, validation, ownership, and legacy-fallback rules.

Classify the current review outcome into a machine-readable flow-state file for the review loop.

This step is a traffic controller only. It must not fix findings, task up findings, or mutate the canonical plan.

<critical_rules>

- When `codeInfoTmp/reviews/<story-number>-current-review-set.json` exists, read it with the matching `current-review-wave-validation.json`, require exact wave identity, and classify only completed or partial job results and their aggregated findings.
- A review set with `closeout_allowed: false` cannot produce a clean/no-findings classification. Missing or unusable cross-repository coverage is an `incomplete_review_blockers` entry when `cross_repository_required` is true; its intentional absence from a slow wave with `cross_repository_required: false` is not a blocker.
- In wave mode, classify only completed or partial review-set jobs whose embedded server-owned validation is usable and exactly matches the target, wave, canonical seven-digit story, plan, review session, review pass, parent execution, HEAD, and comparison base; do not require the legacy plan-host `current-review-validation.json`. When no review set exists, read the prepared review base and `codeInfoTmp/reviews/<story-number>-current-review-validation.json`, accept overall `passed` or `partial` legacy validation for the exact canonical handoff identity, and classify findings only from reviewer entries marked usable.
- Never infer, normalize, repair, or substitute machine identity fields. When at least one reviewer remains usable, record failed, missing, partial, or stale sibling-reviewer coverage as a non-blocking entry in `classification_notes`, continue classifying trustworthy findings, and do not create an `incomplete_review_blockers` entry solely for that lost coverage. Use `incomplete_review_blockers` only when no reviewer is usable or the surviving artifacts do not provide a trustworthy canonical review basis. When no reviewer is usable, do not claim there were no findings.

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` before classifying the review.
- Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Do not discover review artifacts by timestamp.
- Use the stored review handoff plus the artifacts it references as the sole source of review outcome.
- Interpret the review handoff semantically rather than as a brittle exact schema. If optional or newer comparison metadata is missing or shaped differently, use the referenced artifacts, current-plan handoff, and current git state to infer only the minimum safe meaning.
- If the review outcome cannot be interpreted safely, write an incomplete-review state instead of claiming no findings.
- Do not edit the canonical plan, review artifacts, code, tests, docs, or configuration in this step.
- The only file this step may create or update is `codeInfoStatus/flow-state/review-disposition-state.json`.
- Treat `codeInfoStatus/flow-state/review-disposition-state.json` as generated flow state. Do not commit it unless a later human explicitly asks to persist runtime state.
- This classifier participates in a two-phase review cycle when same-cycle state contains `review_phase: "fast"` or `review_phase: "slow"`. Preserve that phase and its cumulative counters exactly; phase-transition prompts own changing it.

</critical_rules>

<prompt_quality_rules>

- Be explicit about what you read, how you classified the findings, and which state fields were set.
- Prefer structured output over prose when recording decisions.
- Use verification loops: after writing the state file, re-open it and confirm it is valid JSON and matches the review outcome you just classified.
- Do not rely on memory from previous turns. Use fresh disk reads and current git state. Do not answer from conversational memory or an earlier snapshot when the files can be re-read from disk now.
- Prefer the inline-fix path when a finding is current-story actionable, has one clear owner repository, and can be honestly attempted in one bounded coding pass. Classify it as task-required only when it clearly needs planning, broader coordination, a larger redesign, or another condition that makes an inline attempt dishonest or unsafe.

</prompt_quality_rules>

<scope_rules>

1. Read `codeInfoStatus/flow-state/current-plan.json` from disk, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
2. Extract `plan_path` and `additional_repositories`. If `additional_repositories` is missing, treat it as none.
3. Use the fresh bounded review-scope packet for the exact relative `plan_path`.
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
- Prefer the minor path for current-story actionable findings that have one clear owner repository and one honest bounded inline attempt, unless a hard no-inline rule is clearly triggered.
- Do not classify a finding as task-required solely because the finding description says the code is contract-sensitive, queue-sensitive, concurrency-sensitive, lifecycle-sensitive, or shared-caller-sensitive.
- Treat `must_fix` findings as findings that must be resolved in this story, not as automatically task-required. A `must_fix` finding may still be classified as minor-batchable when it satisfies every minor-batchable rule below.
- Treat `should_fix` findings as minor-batchable when every minor-batchable rule below is satisfied. Otherwise classify them as task-required.
- Treat `optional_simplification` findings as rejected or non-actionable unless the finding is concrete, localized, low-risk, and explicitly worth fixing in the current story. If it is worth fixing and satisfies every minor-batchable rule, classify it as minor-batchable. Otherwise classify it as task-required only when the review artifact makes it blocking.
- Parse `Scope Impact` as an optional narrowing hint, not as required structural input.
- Valid `Scope Impact` values are `behavioral_regression`, `correctness_bug`, `proof_gap`, `cleanup_preference`, and `unknown_scope_impact`.
- If `Scope Impact` is missing, malformed, or not one of the expected values, normalize it to `unknown_scope_impact`, continue classification normally, and record that normalization in `classification_notes`.
- Only when a finding explicitly says `Scope Impact: cleanup_preference` should that value narrow the review response.
- When a finding explicitly says `Scope Impact: cleanup_preference`, treat it as rejected or non-actionable unless the review artifact also shows one of:
  - a reproduced user-visible or operational failure on the current head;
  - an explicit active-story requirement for that cleanup;
  - an explicit user-approved scope expansion for that cleanup.
- When a finding would alter a known-working runtime contract such as env loading, compose ownership, startup paths, mounted-path mapping, or working-folder selection, do not route it into task-up or minor-fix solely for portability neatness when its normalized `Scope Impact` is `cleanup_preference`. If the current head is not proven broken, preserve it as rejected or non-actionable and record the reason in `classification_notes`.
- When the normalized `Scope Impact` is `unknown_scope_impact`, do not suppress, defer, or discard the finding on that basis alone. Continue using severity, repository ownership, boundedness, and evidence quality to decide whether it is actionable.
- Treat missing required artifacts, unreadable artifacts, stale scope, or an ambiguous review basis as `incomplete_review_blockers` only when the condition prevents honest classification from every usable reviewer. A failed or partial sibling reviewer is a non-blocking coverage note when another reviewer and the canonical findings basis remain usable.
- When the findings artifact and handoff counts disagree, trust the findings artifact and record the mismatch in `classification_notes`.
- Do not classify a finding as current-story actionable solely because a user-facing behavior change would make the code, contract, proof, or automation cleaner.
- If a finding identifies a pre-existing bug, awkward workflow, inconsistency, limitation, or surprising product behavior that is not explicitly part of the story's approved behavior changes, do not treat that alone as current-story implementation scope.
- When an endorsed finding says or clearly implies that the external reviewer's suggested fix is outside approved story scope, apply this rule before the generic user-facing behavior rejection rule below. Evaluate current-story scope against the underlying issue, not against the now-rejected reviewer remedy. Do not reject the underlying finding on that basis alone. Instead classify the underlying issue normally according to severity, boundedness, and evidence quality, while preserving the fix constraint in the finding's routing reason.
- When a finding proposes or implies a user-facing behavior change, first check whether the finding is actually describing an unapproved behavior drift introduced by the current story away from previously approved or preserved behavior.
- If the current story introduced that drift, classify the finding as actionable restoration work for the current story, routing it to `unresolved_minor_batchable_findings` or `unresolved_task_required_findings` according to the normal severity, boundedness, and evidence rules, even when fixing it would visibly restore prior behavior.
- Otherwise, check whether the proposed user-facing behavior change is explicitly approved by the story or explicitly approved later by the user.
- If not, do not route that finding into current-story implementation merely to improve the product contract or redesign current behavior.
- Instead, classify it as `rejected_or_non_actionable_findings` with a concise reason that the change would require a user-facing behavior change outside approved story scope; use this rejection path for cleaner redesigns and pre-existing or otherwise out-of-scope product changes, not for regressions introduced by the current story.
- When an endorsed finding remains actionable but carries a constrained-fix instruction from external review, copy that constraint into the routed finding's `reason` field so later minor-fix or task-up steps know that the underlying issue is actionable but the reviewer's proposed remedy must not be adopted automatically. That routed `reason` is the downstream contract for this nuance.
- Do not classify a finding as `incomplete_review_blockers` solely because honest proof would otherwise need a separate product decision about user-facing behavior. Reserve `incomplete_review_blockers` for incomplete review basis, unreadable required artifacts, stale scope, or other conditions that prevent honest review from being completed at all.
- For testing-additions and proof-authoring stories, prefer `document current behavior` over `change behavior to make proof easier`.

</classification_rules>

<minor_batchable_rules>

A finding is minor-batchable only when all of these are true:

- It has one clear implementation owner repository, even if broader later validation may span other affected repositories.
- It is bounded enough to attempt directly in one coding pass without first planning a multi-step implementation sequence, even when the finding is not merely a tiny cleanup.
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

If a rule clearly fails, or fresh source inspection already shows the finding needs broader coordination, a larger contract choice, or a wider redesign than one bounded coding pass, classify the finding as task-required. Otherwise prefer one honest inline attempt first and let the coding step explicitly reclassify the finding when that attempt proves insufficient.

</minor_batchable_rules>

<state_schema>

Write `codeInfoStatus/flow-state/review-disposition-state.json` with this JSON shape:

```json
{
  "schema_version": 1,
  "generated_at_utc": "<ISO-8601 UTC timestamp>",
  "story_id": "<exact seven-digit story ID from the validated review session>",
  "story_number": "<story number from plan_path>",
  "plan_path": "<canonical plan path>",
  "review_session_id": "<validated server-owned review session ID>",
  "parent_execution_id": "<validated parent flow execution ID>",
  "head_commit": "<validated full current repository HEAD>",
  "comparison_base_commit": "<validated full current repository comparison base>",
  "review_cycle_id": "<story-number>-rc-<YYYYMMDDTHHMMSSZ>-<8char-hex>",
  "review_handoff_path": "codeInfoTmp/reviews/<story-number>-current-review.json",
  "review_pass_id": "<review pass id or null>",
  "evidence_file": "<path or null>",
  "findings_file": "<path or null>",
  "saturation_file": "<path or null>",
  "challenge_file": "<path or null>",
  "review_decision_recording": {
    "review_pass_id": "<exact current review pass id>",
    "outcome": "pending",
    "accepted_count": 0,
    "ignored_count": 0,
    "plan_commit_sha": null
  },
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
  "operationally_blocked_minor_findings": [
    {
      "id": "<finding id or null when the interruption was pass-global before one finding could be isolated>",
      "repository": "<repository owner or null>",
      "summary": "<short summary or pass-level description>",
      "reason": "<why the finding remains unresolved but inline minor fixing was unsafe in this pass>",
      "blocker": "<operational interruption summary>",
      "blocker_scope": "<finding_only|global>"
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
    "operationally_blocked_minor": 0,
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
- For the same active two-phase cycle, preserve `review_phase`, `fast_review_pass_count`, `fast_reviewed_pass_ids`, `fast_current_pass_minor_count_before_fix`, `fast_phase_complete`, and `slow_review_completed`. The dedicated fast-pass recorder and phase-transition prompts own those fields.
- Treat those six two-phase fields as optional extensions to the JSON shape above. Do not initialize them in this classifier when `review_phase` is absent; the first fast-pass recorder owns creating them, and standalone review flows must remain phase-free.
- Preserve and deduplicate same-cycle `unresolved_task_required_findings` and `incomplete_review_blockers` across fast passes and into the slow pass because task-up deliberately runs once after both phases. Do not discard a serious fast-review finding merely because the current canonical artifact belongs to a later pass.
- Treat unresolved minor findings as current-pass work. Preserve cumulative resolved-minor history, but build the current minor queue from the current validated findings plus any still-visible operationally blocked minor state.
- Do not try to close a new review cycle by scanning the canonical plan for an older completed final revalidation task from an earlier cycle. Fresh review-loop starts are separated by `reset_review_cycle_state.md`.
- `operationally_blocked_minor_findings` is not part of the initial endorsed-finding classification from the findings artifact. It is a later review-loop state bucket populated only after an inline minor-fix attempt ends with `status: "blocked"`.
- During the fast phase, do not promote a valid minor finding to task-required merely because an earlier fast pass fixed other minor findings. The bounded fast-review controller permits up to five successfully recorded reviewer passes and owns deciding when that phase stops.
- During the slow phase, classify the one slow pass normally and leave its minor findings in the minor queue for the existing fix path. Do not request another slow reviewer invocation.
- `needs_review_rerun_before_close` is phase-local routing state. The fast-pass recorder sets it from the accepted minor count and pass number; the slow phase and combined finalizer keep it false.
- Outside an active two-phase cycle, preserve the established standalone policy: allow at most one fresh rerun after inline minor-fix work or an operational interruption. If the previous same-cycle state already requested that rerun, route any still-unresolved concrete condition to `unresolved_task_required_findings`, or an ambiguous/incomplete condition to `incomplete_review_blockers`, and set `needs_task_up_path` true instead of requesting another rerun.
- During an active two-phase cycle, `needs_final_minor_fix_revalidation_task` must remain false during classification. The combined finalizer sets it only after both review phases have completed and all minor queues have been drained.
- Outside an active two-phase cycle, `needs_final_minor_fix_revalidation_task` is true only when minor fixes have been made, the current pass has no unresolved findings or incomplete-review blockers, `minor_fix_revalidation_cycle_closed` is not true, and `final_revalidation_owned_by_task_up_path` is not true.
- `review_created_tasks_added_or_updated` must remain false in this classifier step. Later task-up or final-revalidation steps may update it.
- `safe_to_exit_review_loop_without_tasking` must remain false during fast or slow classification. The combined finalizer is the only pre-tasking step that may set it true after both phases complete without actionable work. Outside an active two-phase cycle, recompute it using the established standalone closeout conditions.
- Initialize `review_decision_recording` for every newly classified pass with the exact current `review_pass_id`, `outcome: "pending"`, zero counts, and `plan_commit_sha: null`. Never carry a recording outcome from an earlier pass into the current pass. The recorder and verifier own replacing this pending value before downstream review work begins.

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
- Confirm a fresh bounded review-scope packet was loaded.
- Confirm the review handoff and referenced findings artifact were read.
- Confirm every endorsed finding was classified into exactly one state bucket.
- Confirm uncertain findings were classified as task-required rather than minor.
- Confirm no finding was treated as current-story actionable solely because a user-facing behavior change would make the contract cleaner, more consistent, or easier to prove.
- Confirm any finding that would change established user-facing behavior was kept out of current-story action unless that behavior change was explicitly approved by the story or explicitly approved later by the user, or the finding was a story-caused preserved-behavior regression being routed as actionable restoration work.
- Confirm any carry-forward state you preserved came from the same still-active review loop rather than an earlier completed review cycle.
- Confirm `review_cycle_id` is present and belongs to the active review loop you just classified.
- Confirm you did not treat an older completed final revalidation task in the canonical plan as proof that a fresh new review cycle was already closed.
- Confirm two-phase counters and cumulative serious/fixed-finding history were preserved only from the same active `review_cycle_id`.
- Confirm no valid minor finding was promoted to task-required solely because a previous fast-review pass already fixed findings.
- Confirm the state file is valid JSON after writing.
- Confirm the state counts match the arrays in the state file.
- Confirm this step did not edit the canonical plan, review artifacts, code, tests, docs, or config.

</verification_loop>
