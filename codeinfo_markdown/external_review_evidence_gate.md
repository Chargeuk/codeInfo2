The base `review_evidence_gate` command sequence has already been applied for this external-review variant.

Apply these external-review-specific additions after that shared base sequence:

1. Before doing evidence work, derive and read the sole external review input file at `codeInfoStatus/reviews/<story-number>-external-review-input.md` using the canonical plan story number from `codeInfoStatus/flow-state/current-plan.json`.
2. If that file is missing, stop and say the external review input file is missing and must be created before this flow can continue.
3. Treat that markdown file as the sole source of raw external review comments for artifact generation. Do not discover external review comments anywhere else and do not use timestamp or latest-file discovery.
4. While gathering evidence, extract and summarize the raw external review comments grouped by file and reviewer, and carry them forward as candidate findings that still need validation in the next step.
5. When writing the evidence summary, include a dedicated section that records:
   - the exact external review input file path;
   - the raw external review comments grouped by file and reviewer;
   - any comments that obviously require deeper validation in the findings step.
6. Keep the base prompt's `Risk-Invariant Matrix` requirement for the top risky helpers/functions. External review comments can influence which helpers are highest-risk, but they do not replace the need to record invariants, contradictory inputs, and proof strength.
7. When writing or overwriting `codeInfoStatus/reviews/<story-number>-current-review.json`, extend the base handoff with:
   - `external_review_input_file`
8. Keep the rest of the handoff contract aligned with the shared `review_evidence_gate` base sequence, including stable repo aliases, ancestry-aware resolved base branches, current HEAD commits for every repository in scope, and the risk-invariant matrix for the top risky helpers/functions.
9. Report the evidence summary and the exact handoff file path when done.
