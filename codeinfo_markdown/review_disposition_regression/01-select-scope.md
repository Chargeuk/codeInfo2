# Goal

Select the exact review-disposition prompt files that should be checked for regression in the current branch diff.

This is a review-only step. Do not edit files.

<critical_rules>

- Work only from the `"$CODEINFO_ROOT"` branch diff against `origin/main`.
- Use direct git reads anchored to `"$CODEINFO_ROOT"`, such as `git -C "$CODEINFO_ROOT" diff --name-only origin/main...HEAD`, to identify the changed files in scope.
- Focus on review-disposition prompt files, especially:
  - `codeinfo_markdown/classify_review_disposition.md`
  - `codeinfo_markdown/fix_next_minor_review_finding.md`
  - `codeinfo_markdown/ensure_review_findings_became_tasks.md`
  - `"$CODEINFO_ROOT/codeinfo_markdown/review_disposition_regression_checklist.md"`
- Include any other directly related review-disposition prompt file only if it is also present in the current diff.
- Do not edit files, do not propose code changes, and do not task anything up in this step.

</critical_rules>

<output_contract>

- Report the exact `"$CODEINFO_ROOT"` review-disposition prompt files that are in scope for this regression check.
- If none of the review-disposition prompt files changed in the current diff, say that explicitly.
- Briefly explain why each selected file is relevant to the regression check.

</output_contract>
