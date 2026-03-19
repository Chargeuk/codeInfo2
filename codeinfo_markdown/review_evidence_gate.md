Now that everything has been implemented, start a 3-step review sequence for the current story. This first step is an evidence gate only, not the findings pass and not the plan-editing pass. First read `codeInfoStatus/flow-state/current-plan.json` and treat it as the SOLE source of review scope for this flow.

This handoff file supports two shapes:
- Legacy single-repository shape: `{ "plan_path": "planning/<story-file>.md" }`
- Multi-repository shape: `{ "story_id": "<story-number>", "review_mode": "single_repo"|"multi_repo", "repos": [ { "repo_id": "<name>", "repo_root": "/abs/path/to/repo", "plan_path": "planning/<story-file>.md", "branch": "feature/<story-number>-...", "base_branch": "main" } ] }`

Normalize the handoff before proceeding:
- If the legacy `plan_path` shape is present, treat this as a single-repository review whose sole repo entry is the current repository root, the current branch, base branch `main`, and the selected relative `plan_path`.
- If the `repos` array shape is present, use ONLY those repo entries and do not invent additional repositories or plan files.

Validation rules:
- Every selected `plan_path` must exist inside its repository.
- Every selected plan filename must carry the same story number.
- For the legacy single-repository shape, verify that the story number in the current branch name matches the story number in the selected plan filename.
- For the multi-repository shape, verify that each repo entry's `branch` either matches the currently checked-out branch in that repository or, if omitted, can be derived by reading the branch currently checked out at `repo_root`. In either case, the story number in that branch name must match the story number in the selected plan filename for that repository.
- If any of those checks fail, stop and say the current-plan handoff is stale and must be regenerated.

Then re-read every active plan from disk, inspect each selected repository branch against its `base_branch` (default `main` when omitted), and gather the evidence a PR reviewer would need before issuing findings. For multi-repository stories, you MUST also gather cross-repository integration evidence rather than treating each repository in isolation.

Repository review policy:
- Treat `flows/**` as approved workflow configuration. Changes under `flows/**` must not be classified as suspicious, out-of-scope, or scope creep solely because they are absent from the active plan, but they should still be reviewed normally for workflow behavior, instruction safety, and other engineering concerns.
- Treat any `AGENTS.md` file, `codeInfoStatus/**`, `codex_agents/**`, `codeinfo_markdown/**`, `codeinfo_simple_stories/**`, and planning files anywhere in the repository as allowed support-file changes. These files must not be classified as suspicious, out-of-scope, scope creep, or unwanted solely because they changed outside the active story. For these allowed support files, review ONLY for spelling, grammar, and obvious wording mistakes. Do NOT review them for workflow-contract correctness, artifact hygiene, path usage, instruction/runtime safety, plan-selection rules, story-scope alignment, or revert-worthiness.

Required work:
1. Re-read the full active planning document for every selected repository and extract the Description, Acceptance Criteria, Out of Scope, and the final completed tasks.
2. Inspect `git -C <repo_root> diff --name-status <base_branch>...HEAD` plus the recent branch commits for every selected repository.
3. Group changed files by repository, then within each repository group them into planned implementation files, planned docs/tests, allowed spelling/grammar-only support files, approved workflow configuration under `flows/**`, and suspicious or out-of-scope files. Do not place allowed support files in the suspicious or out-of-scope bucket solely because they are absent from the active plan.
4. For every acceptance criterion in every selected plan, identify the current proof source: code path, tests, wrapper/test logs, screenshots/manual proof, or note that the proof is weak/missing.
5. For multi-repository stories, add a dedicated cross-repository evidence section covering integration seams, ownership boundaries, dependency direction, compatibility expectations, and any before/after contract comparison that only becomes visible when two or more repositories are considered together.
6. Call out any implementation area that looks more complex or verbose than the planned work actually required, even if it may still be correct.
7. For each changed file or helper OUTSIDE the allowed spelling/grammar-only support-file set, record any review hotspots that the findings pass must inspect explicitly: merge-before-validate logic, normalization-before-validate logic, bootstrap or existence checks, helpers that return warnings/errors/reason metadata, shared log markers or shared response fields, fallback-selection logic, duplicate/conflicting object keys, deleted/moved/conditional validation, partial-failure handling, dead-field or dead-branch risk, any helper that could hide misconfiguration by defaulting too early, and any alias-migration or backward-compatibility helper where legacy and canonical fields can partially coexist in mixed-shape configs.
8. Identify any changed external contract surfaces OUTSIDE the allowed spelling/grammar-only support-file set that need explicit before/after comparison in findings: API routes, config file shapes, persisted artifacts, wrapper outputs, log marker/event schemas, and legacy alias/deprecated-input compatibility where old and new field shapes may coexist. Note where backward-compatibility risk exists and where the active plan explicitly permits an edge-case deviation from generic best practice.
9. Name the top 3 changed helpers/functions by review risk from the non-support-file changes across the whole review scope, and record the worst malformed or contradictory input each one should reject or survive, plus whether that path currently has direct proof, indirect proof, or missing proof.
10. Generate a unique `review_pass_id` using the shared story number, a UTC timestamp, and the current repository short SHA for the coordinating repository running this flow. Record the per-repository HEAD short SHA values separately in the evidence summary and handoff.
11. Write the evidence summary to `codeInfoStatus/reviews/<review_pass_id>-evidence.md`. This evidence file is a durable review artifact that MUST be committed later so a human can inspect it after the story completes.
12. Write or overwrite a handoff file at `codeInfoStatus/reviews/<story-number>-current-review.json` containing at least: `story_id`, `review_mode`, `review_pass_id`, `evidence_file`, `findings_file` set to null, and a `repos` array where each entry contains at least `repo_id`, `repo_root`, `plan_path`, `branch`, `base_branch`, and `head_commit`. This handoff file is the ONLY review file the next step may use; do not rely on timestamps or `latest file` discovery. Treat the handoff file as transient workflow state, not as the durable review artifact.
13. Do not edit any plan in this step unless a tiny note is absolutely required to unblock the review, and do not commit in this step unless you had to make tracked changes for that unblock. Report the evidence summary and the exact handoff file path when done.
