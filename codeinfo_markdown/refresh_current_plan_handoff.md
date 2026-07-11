# Goal

Refresh the existing `codeInfoStatus/flow-state/current-plan.json` handoff for the CURRENT selected story without rediscovering or switching to a different story.

<critical_rules>

- Do NOT rediscover the next plan in this step.
- Do NOT switch to a different story in this step.
- Use fresh disk reads and current git state, not conversational memory.
- Treat the existing `codeInfoStatus/flow-state/current-plan.json` handoff as the sole source of selected-story scope for this step.
- If the handoff is missing, unreadable, or no longer points at a readable plan, stop and say the current-plan handoff must be regenerated.

</critical_rules>

<scope_rules>

1. Re-read `codeInfoStatus/flow-state/current-plan.json` from disk.
2. Determine the existing active `plan_path` from that handoff, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile story-scope`.
3. Re-check current repository branch state from git, for example with `git branch --show-current`.
4. Re-derive repository scope from the plan file's `Additional Repositories` section, supporting both `## Additional Repositories` and `### Additional Repositories`.
5. If the plan has no `Additional Repositories` section, treat it as `- No Additional Repositories`.
6. Treat the current repository as implicit and always in scope.
7. If the current repository also appears in `Additional Repositories`, treat that as redundant and ignore it.
8. If an additional repository path is missing, invalid, unreadable, or ambiguously mapped from the plan, stop and say the current-plan handoff must be regenerated.

</scope_rules>

<branch_refresh_rules>

1. Before touching any newly added additional repository in this step, read that repository's `AGENTS.md` and follow its repository-specific workflow rules.
2. For each additional repository now in scope, re-check its current git branch directly from disk, for example with `git -C <repo_root> branch --show-current`.
3. Ensure the current repository and every additional repository in scope are on branches whose story numbers match the selected plan filename.
4. If an additional repository is newly in scope and does not yet have a matching-story branch, create or reuse one safely without overwriting local changes.
5. If this step creates a branch, remember what branch or ref it was created from so it can be recorded as `branched_from`.
6. If switching branches in any repository would overwrite local changes, stop and say repository branch setup is blocked by local changes instead of forcing the checkout.

</branch_refresh_rules>

<handoff_write_rules>

Build the refreshed canonical handoff payload using:

```json
{
  "plan_path": "<relative path to the selected story/spec file>",
  "branched_from": "<optional current-repo source branch or ref>",
  "additional_repositories": [
    {
      "path": "/abs/path/to/repo-b",
      "branched_from": "<optional repo-b source branch or ref>"
    }
  ]
}
```

- Preserve any existing `branched_from` value for the current repository or an additional repository that remains in scope, unless this refresh step itself created that branch and can replace it with a new concrete value.
- Remove a repository entry, and any associated `branched_from`, only when that repository is no longer in scope.
- If the refreshed handoff meaning is unchanged and there are no new `branched_from` values to add, leave `codeInfoStatus/flow-state/current-plan.json` untouched.
- Otherwise, update `codeInfoStatus/flow-state/current-plan.json` in place to the refreshed canonical payload.
- Do NOT delete the handoff file first unless an in-place update is genuinely impossible.
- Commit `codeInfoStatus/flow-state/current-plan.json` only if it changed in this step.
- Do NOT push in this step.

</handoff_write_rules>

<output_contract>

- Report whether the handoff scope changed or stayed the same.
- Report whether any new repository branches had to be created or reused.
- Report whether `codeInfoStatus/flow-state/current-plan.json` was left unchanged or updated.

</output_contract>

<verification_loop>

- Confirm you re-read the existing handoff from disk.
- Confirm you used a fresh bounded story-scope packet for the stored `plan_path`.
- Confirm you did not rediscover or switch to a different story.
- Confirm the current repository and every in-scope additional repository are on matching story branches.
- Confirm you did not overwrite local changes while refreshing branch scope.
- Confirm the final handoff payload still matches the selected plan and in-scope repositories.

</verification_loop>
