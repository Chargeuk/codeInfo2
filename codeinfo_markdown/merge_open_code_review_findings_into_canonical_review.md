# Goal

Merge validated Open Code Review candidates into the already current canonical findings artifact without changing the existing main or Codex review pipelines.

This step may update only:

- `codeInfoTmp/reviews/<story_id>-current-review.json`;
- its referenced canonical `findings_file`;
- `codeInfoTmp/reviews/<story_id>-current-open-code-review.json`;
- `codeInfoTmp/reviews/<open_code_review_pass_id>-open-code-review-merge.md`; or
- `codeInfoTmp/reviews/<review_session_id>-open-code-review-merge-skipped.md` when no OCR pass ID was published.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first and derive the exact seven-digit `story_id` from the canonical plan filename. Never use numeric `story_number` for artifact paths.
- Read the prepared review base, current-review handoff, current-open-code-review pointer, and `codeInfoTmp/reviews/<story_id>-current-review-validation.json` from their exact stable paths. Never use glob, timestamp, latest-file, or alternate-prefix discovery.
- Require the validation entry for `current-open-code-review` to be usable and require exact equality across all four artifacts for `story_id`, `plan_path`, `review_session_id`, canonical `review_pass_id` / `canonical_review_pass_id`, `parent_execution_id`, `head_commit`, and `comparison_base_commit`. The overall validation may be `partial` because another reviewer or OCR bundle failed.
- Require the OCR pointer to report completed execution and a usable repository-relative `review_output_file` inside `codeInfoTmp/reviews`. Accept `passed` or `partial` OCR validation and use only the bundle IDs listed as usable by the server-owned validation result.
- Treat the server-rerendered, byte-matched per-bundle reports for `usable_bundle_ids` as the only OCR candidate-finding source. The aggregate OCR Markdown is coverage and navigation context only; it must not independently introduce a finding.
- Treat OCR output as candidate findings, not automatically endorsed findings.
- Preserve all existing canonical findings. Do not remove or rewrite them because OCR disagrees.
- On a missing, malformed, stale, wholly invalid, or mismatched OCR pass, record the skipped pass visibly and finish this merge step without stopping later flow steps. Partial OCR is usable: exclude invalid bundles, merge valid bundle findings, and preserve the coverage warnings.
- If `open_code_review_pass_id` is missing, do not infer or invent it. Use the exact prepared `review_session_id` in the deterministic skipped-merge path, leave the unavailable OCR pointer unchanged, and do not add OCR merge fields to the canonical handoff.
- Re-read the prepared base and stable pointers immediately before publishing updates. Stop rather than overwriting artifacts owned by another session. Write JSON updates atomically.

</critical_rules>

<merge_rules>

1. Read the canonical findings artifact before making any decision.
2. Read the exact OCR Markdown referenced by `review_output_file` as coverage context, then read the byte-matched reports for bundle IDs marked usable by server validation as the sole candidate-finding inputs.
3. Parse findings only from those validated bundles. Coverage notes, failed-bundle diagnostics, residual uncertainty, excluded planning files, and `No findings.` are not findings.
4. For every candidate, determine whether it is new, equivalent to an existing main/Codex finding, unsupported, non-actionable, or outside the story.
5. Keep the canonical finding when OCR restates the same root cause and record the OCR candidate as a duplicate.
6. Merge genuinely new actionable findings in the canonical format and severity order with `Origin: open_code_review` provenance.
7. Do not assign disposition IDs or widen story scope; later classification and filtering own those decisions.
8. Preserve the canonical findings artifact as the only findings source consumed downstream.

</merge_rules>

<output_contract>

When a usable OCR pass ID exists, write `codeInfoTmp/reviews/<open_code_review_pass_id>-open-code-review-merge.md` containing the exact input paths, identity validation result, merged candidates, duplicates, rejected/deferred candidates, and reasons. When no OCR pass ID was published, write `codeInfoTmp/reviews/<review_session_id>-open-code-review-merge-skipped.md` with the validation failure and finish cleanly without updating either pointer.

Update the canonical handoff additively with:

- `open_code_review_pointer_file`;
- `open_code_review_output_file`;
- `open_code_review_pass_id`;
- `open_code_review_merge_file`;
- `open_code_review_generated_findings`.

Update the OCR pointer with:

- `merge_output_file`;
- `merged_into_canonical_findings`;
- `merged_findings_file`.

If no OCR issue is merged, leave canonical findings unchanged and set the generated/merged booleans to `false`. Preserve all fields not owned by this step.

</output_contract>

<verification_loop>

- Confirm the server validation belongs to this exact session and marks the OCR pass usable, whether passed or partial.
- Confirm all inputs came from exact stable pointers.
- Confirm the canonical findings file was read first.
- Confirm every merged candidate is validated, actionable, new, and provenance-labelled.
- Confirm `planning/**` exclusions and coverage notes were not converted into findings.
- Confirm the canonical findings artifact remains the sole downstream source.
- Confirm the prepared session remained unchanged before atomic publication.

</verification_loop>
