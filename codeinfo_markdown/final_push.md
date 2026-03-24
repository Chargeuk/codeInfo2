## Task

Finalize the current story across every repository that is in scope for this flow.

## Critical Rules

1. Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
2. Treat the current repository as in scope even if it is not listed in `additional_repositories`.
3. Do not touch any repository outside this scope.
4. Use fresh disk reads and current git state, not conversational memory.
5. Follow each repository's `AGENTS.md` and prefer that repository's documented linting and formatting commands.
6. Do not create empty commits.

## Exact Step Order

1. Build the ordered repository scope:
   - Start with the current repository.
   - Add every readable repository listed in `additional_repositories`.
   - Ignore duplicate entries for the current repository.
2. In every repository in scope, inspect the current branch and working tree state before making changes.
3. Commit all existing local changes in every repository in scope:
   - If a repository has uncommitted changes, create a commit for those changes on the current story branch.
   - If a repository has no uncommitted changes, skip the commit in that repository.
4. Run linting and prettier across every repository in scope:
   - Use the repository's preferred wrapper or documented scripts when they exist.
   - If separate lint and prettier commands exist, run both.
   - If a repository does not define a prettier command, use the closest documented formatting command instead.
5. If linting or prettier produces auto-fix changes, review the resulting diff and commit those linting or formatting fixes in that repository.
6. Re-check git status in every repository after the linting and prettier pass:
   - If a repository is still dirty because of new changes from linting or formatting, commit those remaining changes.
   - If a repository is dirty for another reason you cannot safely resolve, stop and report the blocker clearly.
7. If possible, git push the current story branch in the current repository and in every repository listed in `additional_repositories`.

## Edge Cases

- If a repository path from `additional_repositories` is missing, unreadable, or not a git repository, stop and report that the current-plan handoff is stale or invalid.
- If a repository is on the wrong branch for the selected story, stop and report the branch mismatch instead of pushing.
- If linting or formatting fails in a repository, do not push that repository. Report the failing command and continue only when it is safe to do so.
- If push fails for a repository, report that failure clearly with the repository path and keep going with the remaining repositories when possible.

## Output

Report the result repository by repository:

1. Whether an initial commit was created.
2. Which linting and formatting commands were run.
3. Whether a lint/prettier follow-up commit was created.
4. Whether push succeeded, was skipped, or failed.
