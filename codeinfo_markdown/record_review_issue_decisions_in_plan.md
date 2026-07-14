# Goal

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/review-wave-consumer-contract.md` first and record wave coverage, target ownership, and severity conflicts explicitly.

Record the current review pass's accepted and ignored issue decisions in the canonical story plan before any minor review fix or task-up implementation begins.

This step runs after story-scope filtering and actionable-finding promotion, immediately before the Minor Review Fix Path. It turns the final current-pass routing state into a concise human-readable `## Code Review Findings` block without changing any routing decision or creating implementation tasks.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before editing the plan.
- Derive the story number from the stored `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Treat `current-plan.json` only as the owner of `plan_path`, optional `branched_from`, and `additional_repositories`. Derive the story number from its `plan_path` and validate its repository scope. Do not require `story_id`, `review_session_id`, `review_pass_id`, `parent_execution_id`, `head_commit`, or `comparison_base_commit` to exist in `current-plan.json`.
- Require the review handoff and review disposition state to agree on every machine identity field they both own for the validated current review, including the exact canonical seven-digit `story_id`, `plan_path`, `review_session_id`, `review_pass_id`, `parent_execution_id`, `head_commit`, and `comparison_base_commit` when those fields are present in both sources. Never infer, normalize, repair, or substitute a conflicting machine identity field.
- Treat missing optional comparison-description metadata as recoverable when the required handoff/state identity agrees. Use the validated handoff value when available and add a concise confidence note when the omission materially limits the description. A genuine identity conflict still requires a safe no-edit result, but must not be reported as a clean no-findings outcome.
- Use `review-disposition-state.json` as the sole source of actionable accepted-versus-rejected routing. Also preserve explicitly rejected or non-adopted current-pass review candidates from the validated findings, challenge, saturation, and external-review artifacts under `Ignored for This Story`; those artifact entries are decision-recording inputs only and must never be promoted into actionable routing by this step.
- Do not reclassify findings, edit review artifacts, change finding queues or task-up routing, create tasks, implement fixes, run proof, or push. The narrow retry bookkeeping below may set rerun/clean-exit flags without changing finding ownership.
- Do not describe an `incomplete_review_blockers` entry as accepted or ignored. It is incomplete review state, not a decided issue.
- Do not invent findings, titles, descriptions, examples, evidence, comparison metadata, or decision reasons.
- Treat the canonical plan as the only tracked file this step may edit. Treat review handoffs, findings artifacts, and disposition state as transient workflow inputs that must not be committed. Update disposition state only for the narrow retry bookkeeping described below; never use that recovery note to reclassify or task up a finding.
- This step owns `review_decision_recording` in disposition state. Always replace the classifier's current-pass `pending` value with one of the exact outcomes defined below before returning normally.

</critical_rules>

<current_pass_rules>

- Record only findings that belong to the exact active `review_pass_id` and validated findings basis.
- Accepted findings are the current-pass entries in `unresolved_minor_batchable_findings` and `unresolved_task_required_findings` after promotion finishes.
- During a late recovery only, when the required current-pass block was not recorded before implementation, also include entries from `resolved_minor_findings` as Accepted when their stable IDs exist in the exact validated current-pass findings artifact. Never pull a resolved entry from an earlier pass or merely from durable carry-forward state.
- Ignored findings are the current-pass entries in `rejected_or_non_actionable_findings` plus review candidates explicitly recorded as rejected or non-adopted in current-pass `Rejected Risk Notes`, `External Review Adjudication Trail`, challenge, or saturation artifact sections.
- Deduplicate ignored entries by stable finding ID or source reference when available, otherwise by the same normalized summary and evidence. Prefer the disposition-state entry when the same candidate appears in state and an artifact.
- Do not pull preserved resolved, rejected, blocked, or historical findings from an earlier review pass into the current block merely because they remain in durable story state.
- Match state entries to the current findings artifact by stable finding ID. For an artifact-only ignored candidate, preserve its existing source reference when one exists; otherwise identify it by its numbered presentation title and provenance rather than inventing a workflow finding ID. When an entry cannot be tied safely to the current pass, omit it from the decision lists and record a concise non-fabricated confidence note only when the remaining validated identity still permits an honest plan update.
- If no accepted or ignored current-pass findings or explicitly rejected current-pass artifact candidates exist, make no plan edit. Leave the genuine no-findings closeout to its existing workflow path.
- If accepted or ignored findings exist but the exact current-pass identity cannot be validated, make no plan edit. Append one deduplicated `classification_notes` entry describing the mismatch, set `needs_review_rerun_before_close` to true and `safe_to_exit_review_loop_without_tasking` to false, and preserve every finding queue and `needs_task_up_path` unchanged. Do not add an `incomplete_review_blockers` entry, because that would bypass the required one-shot attempt. Report a retry-required result normally so the autonomous flow can continue to its deterministic pre-fix gate.

</current_pass_rules>

<recording_state_contract>

Write this bounded current-pass result into `review-disposition-state.json` without changing any finding queue or routing field:

```json
"review_decision_recording": {
  "review_pass_id": "<exact current review pass id>",
  "outcome": "<recorded|no_decisions|retry_required>",
  "accepted_count": 0,
  "ignored_count": 0,
  "plan_commit_sha": null
}
```

- Use `recorded` only after the exact current-pass block is complete, unique, and committed. Set both counts to the numbers actually written and set `plan_commit_sha` to the exact full commit returned by `git log -1 --format=%H -- <plan_path>` after the commit.
- Use `no_decisions` only when the validated current pass genuinely has no accepted, ignored, rejected, or non-adopted candidate. Keep both counts at zero and the commit SHA null.
- Use `retry_required` for an identity conflict, incomplete or uncommitted block, failed commit, or any other condition that prevents either of the two honest outcomes above. Record the best validated counts without inventing entries and keep the commit SHA null.
- Never preserve `pending` when this step completed far enough to write disposition state. A terminal infrastructure failure may leave it pending; the deterministic readiness control will then restart the autonomous review loop.

</recording_state_contract>

<section_contract>

Write one block with this shape:

```markdown
## Code Review Findings

- Review pass: `<review_pass_id>`
- Review cycle: `<review_cycle_id>`
- Comparison context: local `HEAD` `<head_commit>` versus resolved base `<comparison_base_ref>@<comparison_base_commit>` from the stored review handoff, with comparison rule `<comparison_rule>`, resolved base source `<resolved_base_source>`, and remote fetch status `<remote_fetch_status>`.

### Accepted

#### 1. <plain-language title>

- Finding ID: `<stable finding id>`
- Description: <short, simple explanation of the issue>
- Example: <small concrete example grounded in the validated review evidence>
- Why accepted: <why the issue is valid and belongs to the current story>

### Ignored for This Story

#### 2. <plain-language title>

- Finding ID or Review reference: `<stable finding id or existing artifact source reference>`
- Description: <short, simple explanation of the issue>
- Example: <small concrete example grounded in the validated review evidence>
- Why ignored: <why the issue is invalid, unproven, already covered, or outside current-story scope>
```

- Keep the exact heading `## Code Review Findings` so existing review-created task boundary helpers remain compatible.
- Keep the metadata bullets before the categorized findings.
- For multi-repository reviews, include one concise comparison-context bullet per repository when their comparison metadata differs. Name the repository in each such bullet.
- Use full commit SHAs when the validated handoff provides them. Do not shorten an exact stored SHA.
- Preserve material validated comparison details such as `comparison_rule`, `resolved_base_source`, `remote_fetch_status`, and a sanitized local fallback reason when one exists.
- Add a concise confidence or provenance note only when a validated artifact records a material caveat, partial reviewer coverage, external-review origin, or safe descriptive inference. Keep that note with the metadata before `### Accepted` so it cannot be mistaken for part of an issue. Never use a note to excuse an identity mismatch.
- Number issue titles continuously across both categories. Preserve stable finding IDs or existing review references separately because the display number is presentation, not workflow identity. Never manufacture a workflow finding ID for an artifact-only ignored candidate.
- Order accepted findings by their order in the validated findings artifact, then order ignored findings by their order in the validated artifacts. Use stable finding ID or existing source-reference order only as a deterministic fallback.
- If one category has no current-pass entries, write `- None.` below that category instead of omitting the category.
- Keep descriptions easy to understand and limited to the issue itself.
- Ground every example in the validated finding's repository evidence. If the artifacts contain no honest concrete example, write `Example: No concrete example was recorded in the validated review evidence.` rather than inventing one.
- Derive `Why accepted` from the finding evidence plus its final routed reason. Derive `Why ignored` from the stored rejection reason and any recorded scope gate. Do not re-adjudicate either decision.

</section_contract>

<idempotency_rules>

- Identify the current-pass block by the exact `Review pass` metadata value matching the active `review_pass_id` inside a `## Code Review Findings` section.
- If no block exists for the current pass, append the new block to the physical end of the plan.
- If an older terse block exists for the same current pass, replace that block in place with the structured block.
- If the structured block already exists for the same current pass, update it in place only when needed to match the final post-promotion state.
- Never append a second `## Code Review Findings` block for the same `review_pass_id`.
- Never delete, rename, merge, or rewrite a block belonging to an earlier review pass.
- Do not delete or rewrite existing numbered tasks, `## Minor Review Fixes`, or `## Post-Implementation Code Review` sections.

</idempotency_rules>

<commit_rules>

- Re-open the plan after editing and confirm the current-pass block exists exactly once and follows the required structure.
- Run `git diff --check -- <plan_path>` before committing.
- If the plan changed, commit only the canonical plan using the repository's required story commit convention and body requirements.
- Do not include `codeInfoStatus/**`, `codeInfoTmp/**`, review artifacts, or unrelated working-tree changes in the commit.
- If no plan change was needed, do not create an empty commit.
- If committing fails, leave the validated plan edit in place for the verifier to retry, append one deduplicated retry note to disposition-state `classification_notes`, set `needs_review_rerun_before_close` to true and `safe_to_exit_review_loop_without_tasking` to false, and report the non-durable result normally. Do not claim a commit exists, do not task up the findings, and do not deliberately return a failed turn solely because this commit attempt failed.
- After a successful commit, re-open the plan, obtain its exact latest full commit SHA, and write the matching `recorded` outcome before returning. For an already-valid committed block, obtain the existing plan commit in the same way rather than creating an empty commit.
- Do not push.

</commit_rules>

<output_contract>

- Finish with exactly one of three honest outcomes: one durable structured current-pass `## Code Review Findings` block committed before implementation begins; a clean no-edit result because no current-pass accepted or ignored findings exist; or an explicit retry-required result whose disposition state prevents clean exit and whose missing/incomplete block will keep the deterministic minor-fix gate closed.
- Report the plan path, review pass ID, accepted count, ignored count, whether the block was created, replaced, updated, or unchanged, and the plan commit SHA when a commit was created.
- Report the final `review_decision_recording.outcome` and confirm it belongs to the exact current pass.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before review state and review artifacts.
- Confirm `current-plan.json` supplied only plan selection and repository scope, and that the handoff/state machine identities did not conflict.
- Confirm classification and promotion were not changed.
- Confirm any identity or commit recovery updated only retry bookkeeping, preserved every finding queue and `needs_task_up_path`, and did not create an incomplete-review blocker or bypass the one-shot path.
- Confirm every listed issue belongs to the current review pass and exactly one category.
- Confirm every issue has a numbered title, a stable finding ID or existing review reference, a simple description, an evidence-backed example or the explicit no-example fallback, and a decision rationale.
- Confirm accepted and ignored categories both exist, including `- None.` when applicable.
- Confirm the current review pass appears in exactly one `## Code Review Findings` block.
- Confirm historical review-pass blocks and existing tasks remain unchanged.
- Confirm only the canonical plan was committed and nothing was pushed.
- Confirm disposition state contains the exact current-pass recording outcome, matching counts, and the committed plan SHA only when the outcome is `recorded`.

</verification_loop>
