Please tell me the next plan that has not yet been fully executed. Determine this by finding the lowest indexed plan that either does NOT yet have tasks, or includes tasks that are not yet moved to the status of done/completed/complete, such as tasks marked todo or in_progress. planning files could be in a planning folder or somewhere else in the repository. Read the repository `AGENTS.md` for guidance on where to find planning files (sometimes called spec or story files). Do NOT use code_info tools for this search.

When you have found the selected story:

Use fresh disk reads and current git state, not conversational memory. At minimum, re-open the selected plan from disk, re-check current repository branch state directly from git (for example with `git branch --show-current` or an equivalent direct git command), and re-check each additional repository branch directly from git (for example with `git -C <repo_root> branch --show-current` or an equivalent direct git command) before deciding whether branch setup or handoff updates are needed.

1. Confirm what story it is and give a concise overview of the story, including what still remains to be done.
2. Follow the rules within the `## Branching And Phase Flow` section of `AGENTS.md` to ensure the current repository is on the correct story branch, and if not, create or reuse the correct branch and switch to it safely. If this step creates the current repository branch, remember what branch or ref it was created from so it can be recorded later as `branched_from`.
3. Read the selected plan's `Additional Repositories` section if it exists. Support both `## Additional Repositories` and `### Additional Repositories`.
4. If the selected plan has no `Additional Repositories` section, treat it as a legacy single-repository plan and behave as if it said `- No Additional Repositories`.
5. Treat the current repository as the canonical plan host and as implicitly in scope.
6. Before touching any additional repository in this step, read that repository's `AGENTS.md` and follow its repository-specific workflow rules.
7. For each additional repository listed in that section, ensure it is on a branch whose story number matches the selected plan. Reuse any existing matching-story branch if it is already there. If no such branch exists yet, create one from that repository's current checkout so existing local changes stay attached to the new branch, and remember what branch or ref it was created from so it can be recorded later as that repository's `branched_from`.
8. If an additional repository path is missing, invalid, unreadable, or ambiguously mapped from the plan, stop and say the plan must be fixed before the current-plan handoff can be created.
9. Do NOT switch branches in any repository if doing so would overwrite local changes. Stop and say repository branch setup is blocked by local changes instead.
10. Build the expected current-plan handoff payload using this canonical shape:

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

11. `branched_from` is optional. Write it only when this step actually created the branch. Do NOT invent it for a reused existing branch.
12. If the plan says `- No Additional Repositories`, use an empty `additional_repositories` array.
13. The current repository is implicit. If it also appears inside `additional_repositories`, treat that as redundant and omit that entry from the canonical handoff payload.
14. In `additional_repositories`, write repository entries as objects with a required `path` field. The optional `branched_from` field belongs inside that same object when available.
15. Do not use absolute paths for `plan_path`.
16. If `codeInfoStatus/flow-state/current-plan.json` does not exist, create it with that payload.
17. If it already exists, read it and determine its meaning from the information it contains rather than from an exact JSON shape. Work out the active `plan_path`, the additional repository paths in scope, and any existing `branched_from` values that are still attached to repositories remaining in scope.
18. If the existing file already communicates the same selected `plan_path`, the same repository scope, and there are no new `branched_from` values from this run that need to be added or replaced, leave it unchanged and do NOT rewrite it.
19. Otherwise, update the file in place so it matches the canonical payload for the selected plan and repository scope. Do NOT delete it first unless an in-place update is genuinely impossible.
20. Treat any older, incomplete, or differently structured handoff that still communicates the same selected plan as valid input to be normalized rather than as a hard failure. If you can determine the selected plan, repository scope, or preserved `branched_from` values from the existing file, carry that information forward into the canonical output.
21. When updating an existing handoff file, preserve any existing `branched_from` value for the current repository or an additional repository that remains in scope, unless this step created that branch again and can replace it with a new concrete value.
22. Remove `branched_from` only when its repository is no longer represented in the handoff.
23. This handoff file becomes the sole plan-selection source for every later step in the flow.
24. Commit the handoff file only if you created it or changed its contents, and push if you can.

This step owns plan selection, repository branch setup, and current-plan handoff creation together. Do not stop after selecting the story unless one of the blocking conditions above occurs.
