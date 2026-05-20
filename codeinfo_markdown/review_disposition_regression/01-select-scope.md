# Goal

Select the exact review-disposition prompt files that should be checked for regression in the current branch diff.

This is a review-only step. Do not edit files.

<critical_rules>

- Work only from the `"$CODEINFO_ROOT"` branch diff against the resolved comparison base, not a hard-coded branch name.
- Resolve the comparison base by preferring stored comparison metadata when present: use `comparison_base_ref` first, then `comparison_base_commit`. If neither is available, determine the repository default branch and prefer its remote-tracking ref when available; if that remote path is unavailable, fall back to the corresponding local branch or other local ref for that default branch.
- Use direct git reads anchored to `"$CODEINFO_ROOT"` with that resolved base, such as `git -C "$CODEINFO_ROOT" diff --name-only "$COMPARISON_BASE"...HEAD`, to identify the changed files in scope.
- Focus on review-disposition prompt files, especially:
  - `"$CODEINFO_ROOT/codeinfo_markdown/classify_review_disposition.md"`
  - `"$CODEINFO_ROOT/codeinfo_markdown/fix_next_minor_review_finding.md"`
  - `"$CODEINFO_ROOT/codeinfo_markdown/ensure_review_findings_became_tasks.md"`
  - `"$CODEINFO_ROOT/codeinfo_markdown/review_disposition_regression_checklist.md"`
- Include any other directly related review-disposition prompt file only if it is also present in the current diff.
- Do not edit files, do not propose code changes, and do not task anything up in this step.

</critical_rules>

<output_contract>

- Report the exact `"$CODEINFO_ROOT"` review-disposition prompt files that are in scope for this regression check.
- If none of the review-disposition prompt files changed in the current diff, say that explicitly.
- Briefly explain why each selected file is relevant to the regression check.

</output_contract>
