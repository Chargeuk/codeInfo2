Please tell me the next plan that has not yet been fully executed. Determine this by finding the lowest indexed plan that either does NOT yet have tasks, or includes tasks that are not yet moved to the status of done/completed/complete, such as tasks marked todo or in_progress. Do NOT use code_info tools for this search.

When you have found the selected story:

1. Confirm what story it is and give a concise overview of the story, including what still remains to be done.
2. Follow the rules within the `## Branching And Phase Flow` section of `AGENTS.md` to ensure the current repository is on the correct story branch, and if not, create or reuse the correct branch and switch to it safely.
3. Read the selected plan's `Additional Repositories` section if it exists. Support both `## Additional Repositories` and `### Additional Repositories`.
4. If the selected plan has no `Additional Repositories` section, treat it as a legacy single-repository plan and behave as if it said `- No Additional Repositories`.
5. Treat the current repository as the canonical plan host and as implicitly in scope.
6. For each additional repository listed in that section, ensure the same story branch name exists there too. Reuse it if it already exists. If it does not exist, create it from that repository's current checkout so existing local changes stay attached to the new branch.
7. Do NOT switch branches in any repository if doing so would overwrite local changes. Stop and say repository branch setup is blocked by local changes instead.
8. If an additional repository path is missing, invalid, unreadable, or ambiguously mapped from the plan, stop and say the plan must be fixed before the current-plan handoff can be created.
9. Build the expected current-plan handoff payload using only this shape:

```json
{ "plan_path": "planning/<story-file>.md", "additional_repositories": ["/abs/path/to/repo-b"] }
```

10. If the plan says `- No Additional Repositories`, use an empty `additional_repositories` array.
11. The current repository is implicit and MUST NOT be listed inside `additional_repositories`.
12. Do not use absolute paths for `plan_path`.
13. If `codeInfoStatus/flow-state/current-plan.json` does not exist, create it with that payload.
14. If it already exists and already matches the selected `plan_path` and `additional_repositories`, leave it unchanged and do NOT rewrite it.
15. If it already exists but the stored information is missing, stale, or otherwise different from the selected `plan_path` and `additional_repositories`, update the file in place so it matches the expected payload. Do NOT delete it first unless an in-place update is genuinely impossible.
16. Treat the legacy shape `{ "plan_path": "..." }` as incomplete data. If that legacy file matches the selected plan, update it in place to the full canonical shape with `additional_repositories`.
17. This handoff file becomes the sole plan-selection source for every later step in the flow.
18. Commit the handoff file only if you created it or changed its contents, and push if you can.

This step owns plan selection, repository branch setup, and current-plan handoff creation together. Do not stop after selecting the story unless one of the blocking conditions above occurs.
