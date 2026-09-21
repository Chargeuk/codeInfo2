The base `review_evidence_gate` command sequence has already been applied for this external-review variant.

Apply these external-review-specific additions after that shared base sequence:

1. Read `"$CODEINFO_ROOT/codeinfo_markdown/shared/review-artifact-handoff.md"` and follow its applicability-aware, best-effort evidence rules. Missing, malformed, contradictory, or unexpected evidence is an evidence limitation: salvage supported facts, degrade the result to partial or unavailable, and complete the agent turn normally rather than deliberately failing it.
2. When `CODEINFO_GITHUB_REVIEW_HANDOFF_PATH` is present, read that exact execution-scoped handoff first. It overrides every generic `<story-number>-current-review.json` or `<story-number>-external-review-input.md` path in the shared base sequence. Read its `external_review_input_file`, preserve its GitHub identity fields, and write review artifact references back to that same handoff. Never discover or replace it with another execution's generic or latest file.
3. Before relying on any file under `codeInfoTmp/reviews/`, verify that the repository ignores `codeInfoTmp/`. If it does not, report that the repository must ignore `codeInfoTmp/`, treat the evidence as unavailable, and complete normally; do not edit `.gitignore` or any other tracked file.
4. When no execution-scoped GitHub handoff is present, derive and read the sole external review input file at `codeInfoTmp/reviews/<story-number>-external-review-input.md` using the canonical plan story number from `codeInfoStatus/flow-state/current-plan.json`.
5. If that file is missing, report the evidence as unavailable and complete normally. Do not discover another input, guess another path, or fabricate a placeholder artifact.
6. Treat that markdown file as the sole source of raw external review comments for artifact generation. Do not discover external review comments anywhere else and do not use timestamp or latest-file discovery.
7. Treat the external review input file, evidence file, findings file, challenge file, and review handoff as high-quality local review scratch files for the active run only. They must not be committed.
8. While gathering evidence, extract and summarize the raw external review comments grouped by file and reviewer, and carry them forward as candidate findings that still need validation in the next step.
9. For each raw external review comment, capture enough detail for the findings step to separate the claimed issue from the reviewer's proposed remedy. When that information is present in the external review input, preserve:
   - the claimed underlying issue or defect;
   - the reviewer's suggested fix or preferred remedy;
   - whether the comment appears to request or imply a user-facing behavior change.
10. When writing the evidence summary, include a dedicated section that records:
   - the exact external review input file path;
   - the raw external review comments grouped by file and reviewer;
   - any comments that obviously require deeper validation in the findings step;
   - when safely inferable from the external review input, the claimed issue, suggested remedy, and likely behavior-scope sensitivity for each comment so the next step can judge scope without re-parsing the raw markdown from memory.
11. Keep the base prompt's `Risk-Invariant Matrix` requirement for the top risky helpers/functions. External review comments can influence which helpers are highest-risk, but they do not replace the need to record invariants, contradictory inputs, and proof strength.
12. Extend the authoritative handoff selected in step 2 or 4 with:
   - `external_review_input_file`
13. Keep the rest of the handoff contract aligned with the shared `review_evidence_gate` base sequence, including stable repo aliases, remote-first ancestry-aware resolved base branches, `resolved_base_source`, `logical_base_branch`, `remote_name: "origin"`, `remote_fetch_status`, optional fetch-failed-only sanitized `remote_fetch_error`, optional fetch-failed-only `remote_fetch_exit_code`, `local_fallback_reason`, `comparison_base_ref`, `comparison_base_commit`, `comparison_head_ref`, `comparison_rule`, current HEAD commits for every repository in scope, and the risk-invariant matrix for the top risky helpers/functions.
14. Treat those structured fields as the preferred writer format for downstream confidence, while downstream reader prompts remain responsible for semantic best-effort interpretation of older or partially shaped handoffs.
15. When this stage is applicable and the assigned destination is safely writable, confirm that every artifact claimed as produced is a non-empty regular file. If the assigned destination cannot be resolved or written safely, return a normal unavailable summary and do not guess another destination.
16. Report the evidence summary, its partial or unavailable status when applicable, and the exact handoff file path when done.
