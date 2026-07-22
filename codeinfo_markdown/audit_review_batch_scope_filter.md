# Audit the current batch scope filter

This is an autonomous independent audit and recovery step, not a planning interview. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Use immutable evidence and best judgement, preserving uncertainty explicitly.

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story and exact canonical `plan_path`, preserving the padded story identifier from the plan filename. Resolve the exact current immutable batch through `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`. Read `batch-launch.md`, assigned inputs, every job directory, the reconciliation and its audit, and `reconciliation/scope-filtered-findings.md` when present.

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` for the exact selected plan. Read `$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md` and `$CODEINFO_ROOT/codeinfo_markdown/filter_review_findings_to_story_scope.md`; apply the latter's filtering policy sections as the authoritative scope rules while ignoring its legacy state and output instructions.

Independently verify that:

- every actionable pre-filter finding remains actionable, is narrowed with the removed meaning recorded, or is fully removed with its identity, source, target, rejection gate, and evidence-based reason recorded;
- coverage limits, unavailable or partial work, contradictions, ownership, and provenance remain visible;
- no removed item survives under another heading or duplicate description;
- every stated batch ID, review-cycle ID, repository identity, reviewed commit, and path exactly matches the authoritative current-batch handoff, `batch-launch.md`, and assigned inputs; and
- every job's immutable evidence remains unchanged.

Treat a missing, empty, question-only, misleading, or factually inaccurate scope-filter record as recoverable derived-artifact failure, even when the prior agent turn reported provider success. Repair the derived reconciliation and `scope-filtered-findings.md` when necessary. Do not edit any job `input/`, `work/`, `output/`, or `verification/` content, implementation, tests, configuration, provider pointers, review-cycle control state, or the canonical plan.

Copy identities and paths directly from authoritative files; never reconstruct, normalize, abbreviate, or type them from memory. Do not require a rigid schema, heading layout, provider list, reviewer count, or filename pattern inside jobs. Interpret the self-describing evidence semantically.

Always write `reconciliation/scope-filter-audit.md` with a completed, partial, or unavailable result in ordinary prose, every repair made, remaining uncertainty, and the exact audited artifact paths. Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" --batch-root <batch-directory>` as a factual structural check. Before returning, reopen the reconciliation, scope-filter record, and audit; compare their stated identities and paths character-for-character with the authoritative handoff, correct allowed derived-artifact mismatches, and confirm the audit is non-empty. Return a concise execution summary and artifact paths, not questions.
