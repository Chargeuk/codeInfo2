## Task

Finalize the current story across every repository that is in scope for this flow.

## Critical Rules

1. Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
2. Treat the current repository as in scope even if it is not listed in `additional_repositories`.
3. Do not touch any repository outside this scope.
4. Use fresh disk reads and current git state, not conversational memory.
5. Follow each repository's `AGENTS.md` and prefer that repository's documented linting and formatting commands.
6. Do not create empty commits.
7. Continue with other repositories in the list if one or some fail - always try your best to complete what you can.

## Exact Step Order

1. Build the ordered repository scope:
   - Start with the current repository.
   - Add every readable repository listed in `additional_repositories`.
   - Ignore duplicate entries for the current repository.
2. In every repository in scope, inspect the current branch and working tree state before making changes.
3. Commit all existing local changes in every repository in scope:
   - If a repository has uncommitted changes, create a commit for those changes on the current story branch.
   - If a repository has no uncommitted changes, skip the commit in that repository.
4. Before using `plan_sections.py`, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`. Then, before linting or formatting, retrieve the latest approved story scope from the stored plan path with `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --plan "<plan_path>" --profile story-scope`. Apply a clear story-wide restriction directly. Where task-level permission is needed, retrieve the relevant affected task's complete Testing section, including for completed tasks, with `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --plan "<plan_path>" --task-number "<number>" --section Testing`; do not rely on current-task selection. If task-level permission cannot be established, defer only the affected lint/format activity and report the limitation normally; continue independent Git publication.
5. Run linting and formatting only when permitted by the latest approved story scope and every affected task's activity scope:
   - Use the repository's preferred wrapper or documented scripts when they exist.
   - If separate lint and formatting commands exist, run both only when each activity is permitted.
   - If a repository does not define a formatter command, use the closest documented formatting command only when permitted.
   - Do not run explicitly excluded lint, formatting, or related repair. If permission is ambiguous or unreadable, defer only that activity and report the precise limitation in the normal repository outcome; continue independent permitted finalization and ordinary Git work.
   - Do not run an auto-fixing form when repair is excluded; use a documented check-only form only if the repository provides one, otherwise defer that activity.
6. If an allowed lint or formatting command produces auto-fix changes and those repairs are permitted, review the resulting diff and commit those changes in that repository.
7. Re-check git status in every repository after permitted linting and formatting:
   - If a repository is still dirty because of new changes from linting or formatting, commit those remaining changes.
   - If a repository is dirty for another reason you cannot safely resolve, just report the information to the user and leave the unresolvable documents in the repository.
8. If possible, git push the current story branch in the current repository and in every repository listed in `additional_repositories`.

## Edge Cases

- If a repository path from `additional_repositories` is missing, unreadable, or not a git repository, report that to the user, but continue with the others.
- If a repository is on the wrong branch for the selected story, report the branch mismatch for the affected repository instead of pushing it, and continue with the others.
- If an allowed lint or formatting command fails and its repair is permitted, fix it before committing and pushing. If repair is excluded or permission is ambiguous, report the limitation and continue with other repositories and independent Git finalization.
- If push fails for a repository, report that failure clearly with the repository path and keep going with the remaining repositories when possible.

## Output

Report the result repository by repository:

1. Whether an initial commit was created.
2. Which linting and formatting commands were run.
3. Whether a lint/prettier follow-up commit was created.
4. Whether push succeeded, was skipped, or failed.
