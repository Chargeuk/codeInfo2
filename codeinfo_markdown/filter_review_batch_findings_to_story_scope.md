# Filter the current review batch to story scope

Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/review-artifact-handoff.md`. This negative-scope artifact is applicable only when audited reconciliation has supported findings; when this step runs, it must leave a non-empty completed, partial, or unavailable record.

This is an autonomous flow execution step, not a planning interview. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Resolve ambiguity through the authoritative policy and immutable evidence, preserve any remaining uncertainty, and continue with best effort.

This step is the explicit negative scope gate. It removes findings that can already be shown to conflict with story scope; it does not positively authorize survivors merely because no rejection was proven. A separately reset positive-authorization agent evaluates every survivor, then a separately reset materiality agent evaluates only the positively authorized survivors before the independent combined audit and disposition.

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story and exact canonical `plan_path`, preserving the padded story identifier from the plan filename. Set `batch_handoff` to `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`, then set `batch_dir` exactly once by running `batch_dir="$(python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" resolve --batch-handoff "$batch_handoff")"`. Reuse those exact variables throughout this invocation; never discover, retype, reconstruct, or switch to a similar-looking batch path.

Copy the exact batch ID, batch directory, review-cycle ID, repository identities, and reviewed commits directly from the current-batch handoff, `batch-launch.md`, and assigned inputs. Do not type them from memory, normalize them, remove punctuation, or reconstruct them from timestamps or nearby paths.

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` for the exact selected plan. Read `$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md` and follow it strictly. Read `$CODEINFO_ROOT/codeinfo_markdown/filter_review_findings_to_story_scope.md` and apply its `<filter_purpose>`, `<rejection_gates>`, `<required_non_rejection_rule>`, `<authoritative_findings_rule>`, `<ambiguity_rules>`, and `<follow_up_capture_rule>` as the authoritative filtering policy. Its legacy `review-disposition-state.json`, provider-pointer, exact JSON field, and legacy output instructions do not apply to this agent-native batch step.

Read the batch reconciliation and reconciliation audit. Treat only supported findings that remain in the reconciliation's actionable working set as candidates for this gate. Rejected, unsupported, duplicate, already-resolved, or non-actionable reconciliation evidence is an append-only audit trail: read it only enough to conserve identities and provenance, prevent duplication or resurrection, and resolve a factual contradiction. Do not substantially re-evaluate it or reopen its immutable job evidence unless an identity conflict makes that unavoidable.

Reopen immutable job output and verification evidence only as needed to make an evidence-based scope decision for a current actionable candidate. Do not assume a provider list, expected reviewer count, required finding schema, filename pattern inside a job, or heading layout.

## Filtering boundary

- Treat the audited batch reconciliation as the derived actionable working set, not as immutable reviewer evidence.
- Evaluate only the actionable candidates present when this gate begins. Do not restore or reconsider a finding already rejected or removed before this gate.
- Separate each candidate's technical observation, demonstrated consequence, and every proposed remedy before applying the rejection policy. A story requirement for an outcome does not automatically put every mechanism for achieving that outcome in scope.
- Check proposed mechanisms literally against every relevant Out Of Scope statement. Do not describe a new schema field, runtime branch, retry control, timeout, validation failure, fallback, or other excluded mechanism as mere configuration or as policy-free without current-HEAD repository evidence that the claimed existing control actually exists.
- Do not modify anything under a job's `input/`, `work/`, `output/`, or `verification/` directories.
- Do not modify implementation, tests, configuration, the canonical plan, review-cycle control state, or provider pointers.
- Preserve job coverage, unavailable or partial results, contradictions, ownership, and evidence provenance in the reconciliation.
- Remove a fully out-of-scope finding only from the reconciliation's actionable findings.
- When a finding combines an in-scope issue with an out-of-scope remedy, narrow the actionable reconciliation entry to the in-scope core and preserve the removed remedy in the filtering record.
- When the observation is technically useful but every demonstrated remedy is excluded, preserve the observation as non-actionable evidence rather than leaving an implementation candidate with no in-scope repair path.
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
3. Confirm every surviving remedy names an implementation mechanism that is not excluded by the story, and that any claim that the mechanism already exists is supported by current-HEAD repository evidence.
4. Confirm no previously rejected or scope-filtered item remains actionable under another heading or duplicate description, without repeating substantial semantic analysis of coherent removals.
5. Confirm coverage, partial or unavailable work, contradictions, ownership, and provenance remain visible.
6. Confirm every job directory and its contents are unchanged.
7. Confirm `scope-filtered-findings.md` exists and honestly describes the completed, partial, or unavailable result.
8. Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" check --batch-handoff "$batch_handoff"` and repair only this step's derived scope artifacts; report scheduler-owned structural failures without recreating their evidence.
9. Reopen `scope-filtered-findings.md` and compare every batch identity and path it states character-for-character with the authoritative handoff and `batch-launch.md`; correct every mismatch before returning.

Report what remained actionable, what was removed or narrowed, what could not be decided, and the filtering-record path. Return an execution summary, not questions.
