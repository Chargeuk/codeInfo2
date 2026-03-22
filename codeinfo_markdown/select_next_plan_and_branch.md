Please tell me the next plan that has not yet been fully executed. This can be determined by looking for plans that either do NOT yet have tasks, or that include tasks that are not yet moved to the status of done/completed/complete, for example it may have tasks that are todo or in_progress. The lowest indexed story that meets one of these two criteria will be the story we will be working on. Do NOT use code_info tools for this search.

Confirm to me what story that is, and provide me with an overview of the story, including what is still remaining to be done, without making file changes at this time.

When you have found the story:

1. Follow the rules within the `## Branching And Phase Flow` section of `AGENTS.md` to ensure the current repository is on the correct story branch, and if not, create or reuse the correct branch and switch to it safely.
2. Read the selected plan's `Additional Repositories` section if it exists. Support both `## Additional Repositories` and `### Additional Repositories`.
3. If the selected plan has no `Additional Repositories` section, treat it as a legacy single-repository plan and behave as if it said `- No Additional Repositories`.
4. Treat the current repository as the canonical plan host and as implicitly in scope.
5. For each additional repository listed in that section, ensure the same story branch name exists there too. Reuse it if it already exists. If it does not exist, create it from that repository's current checkout so existing local changes stay attached to the new branch.
6. Do NOT switch branches in any repository if doing so would overwrite local changes. Stop and say repository branch setup is blocked by local changes instead.
7. If an additional repository path is missing, invalid, unreadable, or ambiguously mapped from the plan, stop and say the plan must be fixed before the current-plan handoff can be created.
