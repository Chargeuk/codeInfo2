# Single-Target Review Contract

This invocation is one target-local member of a larger parallel review wave. These rules override any later generic instruction that describes the current repository as the plan host, asks you to derive scope from its `current-plan.json`, or asks you to inspect `additional_repositories`.

- Work only in the repository already selected as the working folder. Do not switch branches or inspect sibling repositories.
- Read `codeInfoTmp/reviews/<story-id>-current-review-base.json` first. Treat its `target_id`, `repo_alias`, `repo_root`, `branch`, `head_commit`, `comparison_base_commit`, `review_wave_id`, `plan_host_root`, and `plan_path` as the immutable review contract.
- Confirm the working repository root, current branch, and full local `HEAD` exactly match that prepared base. Stop without publishing a success pointer if they do not.
- Read story scope from the prepared review-context artifact. When bounded plan prose is still needed, use the absolute plan formed from `plan_host_root` plus `plan_path`; never substitute a plan from this target repository.
- Review only this target's local `HEAD` against the prepared comparison base. Do not perform cross-repository compatibility reasoning here; the concurrent cross-repository reviewer owns that responsibility.
- Keep all evidence, findings, validation, report, and stable pointer artifacts under this target's own `codeInfoTmp/reviews` directory. Preserve the prepared target, wave, session, pass, branch, head, and base identity in every published pointer.
- A sibling reviewer failing or returning partial evidence does not invalidate usable target-local evidence from this reviewer. Report this target's outcome honestly and independently.

Continue to apply all later target-local evidence, findings, visual, saturation, adversarial, lifecycle, cleanup, and blind-spot requirements.
