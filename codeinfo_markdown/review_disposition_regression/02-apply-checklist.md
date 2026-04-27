# Goal

Apply the review-disposition regression checklist to the in-scope prompt files from the current branch diff.

This is a review-only step. Do not edit files.

<critical_rules>

- Read `"$CODEINFO_ROOT/codeinfo_markdown/review_disposition_regression_checklist.md"` and use it as the checklist source of truth.
- Re-read the in-scope prompt files from `"$CODEINFO_ROOT"` before judging them. Do not answer from memory.
- Evaluate only the files identified by the previous scope-selection step.
- Do not edit files, do not propose code changes inside this step, and do not task anything up.

</critical_rules>

<check_contract>

- For each checklist item, report `pass` or `fail`.
- When an item fails, explain the wording drift or behavioral regression in one short paragraph.
- If every checklist item passes, say that explicitly.
- Keep the answer concise and focused on regression risk, not style commentary.

</check_contract>
