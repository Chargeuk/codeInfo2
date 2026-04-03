# Goal

Finish the current story review using ONLY the stored review handoff and the artifacts it references, then decide how the canonical plan must respond to the findings.

<critical_rules>

- Do NOT rediscover review artifacts by timestamp.
- First read `codeInfoStatus/flow-state/current-plan.json` and determine the canonical `plan_path`, then extract repository paths from `additional_repositories`.
- If the handoff does not explicitly identify any additional repositories, treat that as none.
- Then read `codeInfoStatus/reviews/<story-number>-current-review.json`, derived from the shared story number.
- If the current-plan handoff checks fail, stop and say the current-plan handoff is stale and must be regenerated. Do not edit any plan.
- If the review handoff is stale or incomplete, stop and say the review must be rerun. Do not edit any plan.
- Treat `flows/**` as approved workflow configuration. Do not reopen the story or record scope-creep findings solely because those files changed without being named in the active plan.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes.
- Do not reopen the story or request reverts solely because those allowed support files changed without being named in the active plan.
- For those allowed support files, only spelling, grammar, and obvious wording findings are actionable.
- This is the only review step allowed to mutate plans.

</critical_rules>

<scope_rules>

- The handoff only needs to communicate a canonical plan path plus any additional repositories in scope.
- The canonical plan always lives in the current repository at `plan_path`.
- Review scope is the current repository plus the repository paths extracted from `additional_repositories`.
- Read `codeInfoStatus/reviews/<story-number>-current-review.json` and verify that its core fields and repo entries still match the normalized review scope and current repository state.
- Treat each stored `resolved_base_branch` as the already-resolved review base chosen by the evidence step. Do not re-resolve a different base unless the review handoff is stale and must be rerun.
- If the review handoff includes `challenge_file`, treat it as optional additive context for this pass. Read it when present.

</scope_rules>

<validation_rules>

Before deciding disposition, validate all of the following:

- the canonical plan exists;
- the canonical plan filename story number still matches the current repository branch story number;
- every repository in scope is still on a branch whose story number matches the canonical plan filename;
- the review handoff is complete and still matches the normalized review scope, canonical `plan_path`, and current repository state.

If the current-plan checks fail, stop and say the current-plan handoff is stale and must be regenerated.

If the review handoff is stale or incomplete, stop and say the review must be rerun.

</validation_rules>

<disposition_rules>

1. If any `must_fix` or `should_fix` findings exist, reopen the story in the canonical plan.
2. Add a `Code Review Findings` summary section to the END of the canonical plan file.
3. Add explicit follow-up tasks using the same structure as previous tasks AFTER the newly added `Code Review Findings`.
4. Add a fresh full re-test/final validation task after those review-fix tasks so the story must be revalidated against the acceptance criteria.
5. Update numbering and cross-references if needed.
6. Every new review-fix task MUST name exactly one repository using `Repository Name`.
7. For cross-repository findings, keep the work in the one canonical plan but split it into repository-specific tasks and make sequencing explicit.
8. If a finding is in an allowed support file, any follow-up task for that file may only request spelling, grammar, or wording corrections.
9. If only `optional_simplification` findings exist, reopen the canonical plan only when the simplification is localized, low-risk, objectively testable, and improves a shared contract.
10. Only defer an `optional_simplification` when the cleanup is speculative, broad, or not worth the churn.
11. If an `optional_simplification` is deferred, record it in a short review note instead of reopening.
12. This `optional_simplification` rule does not permit reopening an allowed support file for anything other than spelling, grammar, or wording corrections.
13. If there are no findings, append a `Post-Implementation Code Review` section to the end of the canonical plan detailing:
    - the branch-vs-base checks performed across all repositories in scope;
    - the acceptance-evidence checks performed;
    - the files inspected;
    - why each repository in scope remains complete;
    - why the story remains complete;
    - the rejected-risk notes carried forward from the findings artifact, plus any blind-spot challenge follow-up when that extra artifact exists.
14. For multi-repository stories with no findings, also record why the cross-repository integration evidence was sufficient.
15. Even when there are no findings, the no-findings path must explicitly state whether each acceptance criterion has direct proof, indirect proof, or missing proof.
16. Even when there are no findings, the no-findings path must explicitly record generic adversarial proof or residual risk across all repositories in scope.
17. If any of those areas remain weakly proven, record that residual risk explicitly rather than implying the review was exhaustive.
18. The current pass `evidence_file` and `findings_file` are durable review artifacts and MUST be added to the commit history alongside any plan changes.
19. When the challenge step exists, treat its artifact as additive context for the no-findings or reopen decision.

</disposition_rules>

<output_contract>

- Produce the correct plan mutations for the findings outcome:
  - reopen the canonical plan and add review-fix tasks when `must_fix` or `should_fix` findings exist;
  - reopen or defer localized `optional_simplification` findings according to the rules above;
  - append `Post-Implementation Code Review` when there are no findings.
- If this review mutates plans, include the durable review artifacts in the resulting commit history alongside those plan changes.

</output_contract>

<verification_loop>

- Confirm the current-plan handoff and review handoff still match the current repository state.
- Confirm every affected repository has been reflected correctly in the canonical plan updates with explicit repository ownership.
- Confirm cross-repository findings produced explicit sequencing and final validation tasks.
- Confirm no allowed support file was reopened for anything other than spelling, grammar, or wording corrections.
- Confirm the no-findings path, if used, explicitly recorded acceptance proof and residual risk across all repositories in scope.
- Confirm durable artifacts remain durable and commit-worthy, while the review handoff remains transient workflow state.

</verification_loop>
