# Goal

Record the current review pass's accepted and ignored issue decisions in the canonical story plan before any minor review fix or task-up implementation begins.

This step runs after story-scope filtering and actionable-finding promotion, immediately before the Minor Review Fix Path. It turns the final current-pass routing state into a concise human-readable `## Code Review Findings` block without changing any routing decision or creating implementation tasks.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before editing the plan.
- Derive the story number from the stored `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Require the current plan, review handoff, and review disposition state to match the exact canonical seven-digit `story_id`, `plan_path`, `review_session_id`, `review_pass_id`, `parent_execution_id`, `head_commit`, and `comparison_base_commit` for the validated current review. Never infer, normalize, repair, or substitute those machine identity fields.
- Use `review-disposition-state.json` as the sole source of accepted-versus-ignored routing. Use the validated findings artifact and other referenced review artifacts only to explain the already-made decision and supply a concrete example.
- Do not reclassify findings, edit review artifacts, change flow-state routing, create tasks, implement fixes, run proof, or push.
- Do not describe an `incomplete_review_blockers` entry as accepted or ignored. It is incomplete review state, not a decided issue.
- Do not invent findings, titles, descriptions, examples, evidence, comparison metadata, or decision reasons.
- Treat the canonical plan as the only tracked file this step may edit. Treat review handoffs, findings artifacts, and disposition state as transient workflow inputs that must not be committed.

</critical_rules>

<current_pass_rules>

- Record only findings that belong to the exact active `review_pass_id` and validated findings basis.
- Accepted findings are the current-pass entries in `unresolved_minor_batchable_findings` and `unresolved_task_required_findings` after promotion finishes.
- Ignored findings are the current-pass entries in `rejected_or_non_actionable_findings`.
- Do not pull preserved resolved, rejected, blocked, or historical findings from an earlier review pass into the current block merely because they remain in durable story state.
- Match state entries to the current findings artifact by stable finding ID. When an entry cannot be tied safely to the current pass, omit it from the decision lists and record a concise non-fabricated confidence note only when the remaining validated identity still permits an honest plan update.
- If no accepted or ignored current-pass findings exist, make no plan edit. Leave the genuine no-findings closeout to its existing workflow path.
- If accepted or ignored findings exist but the exact current-pass identity cannot be validated, make no plan edit and report the identity mismatch.

</current_pass_rules>

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

- Finding ID: `<stable finding id>`
- Description: <short, simple explanation of the issue>
- Example: <small concrete example grounded in the validated review evidence>
- Why ignored: <why the issue is invalid, unproven, already covered, or outside current-story scope>
```

- Keep the exact heading `## Code Review Findings` so existing review-created task boundary helpers remain compatible.
- Keep the metadata bullets before the categorized findings.
- For multi-repository reviews, include one concise comparison-context bullet per repository when their comparison metadata differs. Name the repository in each such bullet.
- Use full commit SHAs when the validated handoff provides them. Do not shorten an exact stored SHA.
- Preserve material validated comparison details such as `comparison_rule`, `resolved_base_source`, `remote_fetch_status`, and a sanitized local fallback reason when one exists.
- Add a concise confidence or provenance note only when a validated artifact records a material caveat, partial reviewer coverage, external-review origin, or safe descriptive inference. Never use a note to excuse an identity mismatch.
- Number issue titles continuously across both categories. Preserve stable finding IDs separately because the display number is presentation, not workflow identity.
- Order accepted findings by their order in the validated findings artifact, then order ignored findings by their order there. Use stable finding ID order only as a deterministic fallback.
- If one category has no current-pass entries, write `- None.` below that category instead of omitting the category.
- Keep descriptions easy to understand and limited to the issue itself.
- Ground every example in the validated finding's repository evidence. If the artifacts contain no honest concrete example, write `Example: No concrete example was recorded in the validated review evidence.` rather than inventing one.
- Derive `Why accepted` from the finding evidence plus its final routed reason. Derive `Why ignored` from the stored rejection reason and any recorded scope gate. Do not re-adjudicate either decision.

</section_contract>

<idempotency_rules>

- Identify the current-pass block by the exact `Review pass: \`<review_pass_id>\``metadata inside a`## Code Review Findings` section.
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
- If committing fails, stop and report the failure without claiming the decision record is durable.
- Do not push.

</commit_rules>

<output_contract>

- Finish with either one durable, structured current-pass `## Code Review Findings` block committed before implementation begins, or a clean no-edit result because no current-pass accepted or ignored findings exist.
- Report the plan path, review pass ID, accepted count, ignored count, whether the block was created, replaced, updated, or unchanged, and the plan commit SHA when a commit was created.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before review state and review artifacts.
- Confirm the plan, handoff, and state identities match exactly.
- Confirm classification and promotion were not changed.
- Confirm every listed issue belongs to the current review pass and exactly one category.
- Confirm every issue has a numbered title, stable finding ID, simple description, evidence-backed example or the explicit no-example fallback, and decision rationale.
- Confirm accepted and ignored categories both exist, including `- None.` when applicable.
- Confirm the current review pass appears in exactly one `## Code Review Findings` block.
- Confirm historical review-pass blocks and existing tasks remain unchanged.
- Confirm only the canonical plan was committed and nothing was pushed.

</verification_loop>
