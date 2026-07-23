# Filter the current review batch to story scope

This is an autonomous flow execution step, not a planning interview. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Resolve ambiguity through the authoritative policy and immutable evidence, preserve any remaining uncertainty, and continue with best effort.

This step is the explicit negative scope gate. It removes findings that can already be shown to conflict with story scope; it does not positively authorize survivors merely because no rejection was proven. A separately reset positive-authorization agent evaluates every survivor before the independent combined scope audit and disposition.

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story and exact canonical `plan_path`, preserving the padded story identifier from the plan filename. Resolve the current immutable batch through `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`; if necessary, discover only the `*-current-review-batch.md` navigation files and confirm the story inside.

Copy the exact batch ID, batch directory, review-cycle ID, repository identities, and reviewed commits directly from the current-batch handoff, `batch-launch.md`, and assigned inputs. Do not type them from memory, normalize them, remove punctuation, or reconstruct them from timestamps or nearby paths.

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` for the exact selected plan. Read `$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md` and follow it strictly. Read `$CODEINFO_ROOT/codeinfo_markdown/filter_review_findings_to_story_scope.md` and apply its `<filter_purpose>`, `<rejection_gates>`, `<required_non_rejection_rule>`, `<authoritative_findings_rule>`, `<ambiguity_rules>`, and `<follow_up_capture_rule>` as the authoritative filtering policy. Its legacy `review-disposition-state.json`, provider-pointer, exact JSON field, and legacy output instructions do not apply to this agent-native batch step.

Read the batch reconciliation and reconciliation audit. Reopen immutable job output and verification evidence only as needed to make an evidence-based scope decision. Do not assume a provider list, expected reviewer count, required finding schema, filename pattern inside a job, or heading layout.

## Filtering boundary

- Treat the audited batch reconciliation as the derived actionable working set, not as immutable reviewer evidence.
- Do not modify anything under a job's `input/`, `work/`, `output/`, or `verification/` directories.
- Do not modify implementation, tests, configuration, the canonical plan, review-cycle control state, or provider pointers.
- Preserve job coverage, unavailable or partial results, contradictions, ownership, and evidence provenance in the reconciliation.
- Remove a fully out-of-scope finding only from the reconciliation's actionable findings.
- When a finding combines an in-scope issue with an out-of-scope remedy, narrow the actionable reconciliation entry to the in-scope core and preserve the removed remedy in the filtering record.
- Never remove a story-caused regression or restoration of previously approved or preserved behavior merely because fixing current `HEAD` changes behavior.
- Never treat the same file, subsystem, nearby code, general hardening value, or a reviewer's preference as sufficient proof of current-story scope.

## Removal record

Always write `reconciliation/scope-filtered-findings.md`, even when no item was removed. Make it self-describing and understandable without an exact schema. Record:

- the story, batch, reviewed repositories, and gate status (`completed`, `partial`, or `unavailable` in ordinary prose);
- each removed finding's original identity and complete meaning;
- its source job and target repository when available;
- the applicable rejection gate and evidence-based reason;
- whether the entire finding was removed or only an out-of-scope remedy was removed;
- the exact in-scope core that remains when a finding was narrowed;
- any uncertainty or unavailable evidence; and
- explicit confirmation that immutable job evidence was not changed.

If the gate cannot safely identify the current batch, load bounded story scope, or account for every actionable reconciliation finding, leave the reconciliation unchanged. Still write an honest partial or unavailable record when the assigned batch directory is known. The surrounding flow must continue with best effort; do not invent a clean gate result or silently perform a partial destructive edit.

## Verification

Before completing:

1. Compare the final reconciliation with the pre-filter actionable set.
2. Confirm every original actionable finding either remains actionable, was narrowed with its removed portion recorded, or was removed with its full meaning and rejection reason recorded.
3. Confirm no scope-filtered item remains actionable under another heading or duplicate description.
4. Confirm coverage, partial or unavailable work, contradictions, ownership, and provenance remain visible.
5. Confirm every job directory and its contents are unchanged.
6. Confirm `scope-filtered-findings.md` exists and honestly describes the completed, partial, or unavailable result.
7. Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" --batch-root <batch-directory>` and repair only factual workspace problems this step is allowed to own.
8. Reopen `scope-filtered-findings.md` and compare every batch identity and path it states character-for-character with the authoritative handoff and `batch-launch.md`; correct every mismatch before returning.

Report what remained actionable, what was removed or narrowed, what could not be decided, and the filtering-record path. Return an execution summary, not questions.
