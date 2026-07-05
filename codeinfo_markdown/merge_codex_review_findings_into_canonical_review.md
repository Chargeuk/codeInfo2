# Goal

Merge the latest native Codex review output into the canonical current-review findings artifact without replacing the existing review pipeline.

This step is an adjudication and artifact-reconciliation step. It may update only:

- `codeInfoTmp/reviews/<story-number>-current-review.json`
- the `findings_file` referenced by that handoff
- `codeInfoTmp/reviews/<story-number>-current-codex-review.json`
- `codeInfoTmp/reviews/<codex_review_pass_id>-codex-review-merge.md`

Do not edit the canonical plan, code, tests, or other review artifacts in this step.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first and derive the story number from its canonical `plan_path`.
- Read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk and treat it as the canonical review handoff.
- Read `codeInfoTmp/reviews/<story-number>-current-codex-review.json` from disk and treat it as the sole pointer to the current Codex review output for this review pass.
- Do not discover Codex review artifacts by timestamp, glob, or latest-file guessing.
- Read the canonical `findings_file` referenced by the current review handoff before deciding what to merge.
- Read the Codex review markdown referenced by `review_output_file` in the Codex pointer file before deciding what to merge.
- Treat the Codex review output as candidate findings, not automatically endorsed findings.
- Preserve existing canonical findings unless this step is explicitly deduplicating an equivalent Codex candidate.
- Do not remove or rewrite existing canonical findings merely because the Codex review disagrees with them.
- Keep any repository comparison metadata already stored in the canonical review handoff untouched unless this step explicitly owns a new Codex-merge field.

</critical_rules>

<merge_rules>

1. Confirm that the canonical review handoff has a usable `findings_file`.
2. Confirm that the Codex pointer file has a usable `codex_review_pass_id` and `review_output_file`.
3. If either required file is missing, unreadable, malformed, or unusable, write a visible merge artifact explaining the blocker and stop without mutating the canonical findings artifact.
4. Parse the Codex review markdown into candidate issues.
5. For each Codex candidate issue:
   - determine whether it is materially equivalent to an existing canonical finding;
   - determine whether it is a genuinely new candidate issue;
   - determine whether it is too vague, duplicate, unsupported, or non-actionable to merge.
6. Preserve the existing canonical findings format and severity language already used by the current findings artifact.
7. When merging a new Codex-derived finding, add clear provenance text such as `Origin: codex_review`.
8. Do not widen story scope in this step. If a Codex issue is potentially real but obviously broader than the current story, record it in the merge artifact as rejected or deferred rather than silently expanding the canonical findings artifact.
9. Prefer deduplication over duplication. If the Codex review restates an existing canonical finding in different words, keep the canonical finding and record the Codex comment as a duplicate/adopted-equivalent in the merge artifact.
10. If a Codex issue is merged, insert it into the canonical findings artifact in findings-first severity order rather than tacking it onto an unrelated section.
11. Do not assign stable review-disposition IDs in this step. Later classification owns that.
12. This step must preserve the existing canonical findings artifact as the source that downstream classification and scope filtering consume.

</merge_rules>

<output_contract>

Write a merge artifact at `codeInfoTmp/reviews/<codex_review_pass_id>-codex-review-merge.md`.

That merge artifact must include:

- the canonical current-review handoff path used;
- the Codex pointer file path used;
- the Codex review markdown path used;
- the canonical findings artifact path used;
- which Codex issues were merged as new findings;
- which Codex issues were treated as duplicates of existing canonical findings;
- which Codex issues were rejected or deferred, and why.

If one or more Codex issues were merged:

- update the canonical findings artifact in place;
- update `codeInfoTmp/reviews/<story-number>-current-review.json` with additive Codex-merge fields:
  - `codex_review_pointer_file`
  - `codex_review_output_file`
  - `codex_review_pass_id`
  - `codex_review_merge_file`
  - `codex_review_generated_findings: true`
- update `codeInfoTmp/reviews/<story-number>-current-codex-review.json` with:
  - `merge_output_file`
  - `merged_into_canonical_findings: true`
  - `merged_findings_file`

If no Codex issues were merged:

- leave the canonical findings artifact unchanged;
- still update `codeInfoTmp/reviews/<story-number>-current-review.json` with:
  - `codex_review_pointer_file`
  - `codex_review_output_file`
  - `codex_review_pass_id`
  - `codex_review_merge_file`
  - `codex_review_generated_findings: false`
- update `codeInfoTmp/reviews/<story-number>-current-codex-review.json` with:
  - `merge_output_file`
  - `merged_into_canonical_findings: false`
  - `merged_findings_file`

Preserve all existing fields in both JSON handoff files unless this step explicitly owns the field being changed.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read first.
- Confirm the canonical current-review handoff was used as the only current-review pointer.
- Confirm the Codex pointer file was used as the only Codex-review pointer.
- Confirm the canonical findings artifact was read before any merge decision.
- Confirm no latest-file or timestamp discovery was used.
- Confirm each merged Codex issue is either genuinely new or explicitly not a duplicate.
- Confirm the canonical findings artifact remains the source that downstream classification will read.
- Confirm the merge artifact path matches the `codex_review_merge_file` written into the handoff.
- Confirm the Codex pointer file now records whether merge occurred and where the merge artifact was written.

</verification_loop>
