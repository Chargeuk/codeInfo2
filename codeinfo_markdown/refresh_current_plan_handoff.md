Refresh the existing `codeInfoStatus/flow-state/current-plan.json` handoff for the CURRENT selected story. Do NOT rediscover the next plan and do NOT switch to a different story in this step.

Use fresh disk reads and current git state, not conversational memory. At minimum:

1. Re-read `codeInfoStatus/flow-state/current-plan.json` from disk. If it is missing, stop and say the current-plan handoff must be regenerated.
2. Determine the existing active `plan_path` from that handoff and re-open that exact relative plan file from disk. If it is missing or unreadable, stop and say the current-plan handoff must be regenerated.
3. Re-check current repository branch state from git, for example with `git branch --show-current` or an equivalent direct git command.
4. Re-derive repository scope from the plan file's `Additional Repositories` section, supporting both `## Additional Repositories` and `### Additional Repositories`. If the plan has no such section, treat it as `- No Additional Repositories`.
5. Treat the current repository as implicit and always in scope. If it also appears in `Additional Repositories`, treat that as redundant and ignore it.
6. For each additional repository now in scope, re-check its current git branch directly from disk, for example with `git -C <repo_root> branch --show-current` or an equivalent direct git command.
7. Ensure the current repository and every additional repository in scope are on branches whose story numbers match the selected plan filename. If an additional repository is newly in scope and does not yet have a matching-story branch, create or reuse one safely without overwriting local changes. If this step creates a branch, remember what branch or ref it was created from so it can be recorded as `branched_from`.
8. If switching branches in any repository would overwrite local changes, stop and say repository branch setup is blocked by local changes instead of forcing the checkout.
9. Build the refreshed canonical handoff payload using:

```json
{
  "plan_path": "planning/<story-file>.md",
  "branched_from": "<optional current-repo source branch or ref>",
  "additional_repositories": [
    {
      "path": "/abs/path/to/repo-b",
      "branched_from": "<optional repo-b source branch or ref>"
    }
  ]
}
```

10. Preserve any existing `branched_from` value for the current repository or an additional repository that remains in scope, unless this refresh step itself created that branch and can replace it with a new concrete value.
11. Remove a repository entry, and any associated `branched_from`, only when that repository is no longer in scope.
12. If the refreshed handoff meaning is unchanged and there are no new `branched_from` values to add, leave `codeInfoStatus/flow-state/current-plan.json` untouched.
13. Otherwise, update `codeInfoStatus/flow-state/current-plan.json` in place to the refreshed canonical payload. Do NOT delete it first unless an in-place update is genuinely impossible.
14. Commit `codeInfoStatus/flow-state/current-plan.json` only if it changed in this step. Do NOT push in this step.

Report whether the handoff scope changed or stayed the same, and whether any new repository branches had to be created.
