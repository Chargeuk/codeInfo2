Read and follow `codeinfo_markdown/code_review_findings.md` first as the base findings-pass contract for this step.

Then apply these external-review-specific additions:

1. Read the `external_review_input_file` referenced by the current review handoff and treat it as candidate review input, not as automatically valid findings.
2. For each external review comment, explicitly decide whether it is:
   - an endorsed finding;
   - a partially valid but non-reopening concern;
   - a rejected comment.
3. Record the reasoning for each decision so a human can see why the external review was or was not adopted.
4. If an external comment identifies a valid, low-risk consistency problem in files already changed by the story, and the fix does not change public payloads or otherwise broaden scope, prefer `should_fix` over `optional_simplification`.
5. Preserve the base prompt's `Rejected Risk Notes` section. When an external comment overlaps one of the top-risk helpers/functions, make that overlap explicit so later blind-spot challenge and disposition steps can see whether the external comment strengthened, weakened, or left unchanged the rejected-risk reasoning.
6. After the findings list, add a short section for rejected or non-adopted external review comments and explain why they were not accepted as findings.
7. When updating the review handoff, preserve the same `findings_file` behavior required by the base markdown and keep any useful counts or disposition hints.
