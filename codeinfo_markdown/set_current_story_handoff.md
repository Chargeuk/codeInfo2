# Goal

Set the active implementation story explicitly from a user-provided story/spec/plan path, then ensure branch scope matches that story and normalize `codeInfoStatus/flow-state/current-plan.json`.

<critical_rules>

- Read the repository `AGENTS.md` first and follow its repository-specific guidance about where executable story/spec/plan files may live.
- Ask the user which story/spec/plan file they want to activate before doing any branch or handoff work.
- Accept an absolute path, a repo-relative path, or a filename-only answer.
- If the user gives only a filename, a partial path, or a slightly wrong path, try to find the intended file inside the current repository without using `code_info` tools first.
- If more than one plausible local match exists, ask the user to clarify which file they want. Do NOT guess.
- Use fresh disk reads and current git state, not conversational memory.
- Do NOT replace the user's explicitly chosen story with a different one just because another plan is lower numbered or already in progress.
- Never select a file inside `codeInfo_simple_stories/` as the active implementation plan.
- If both a detailed implementation plan and a simple-story derivative exist for the same story number, only the detailed implementation plan is eligible.
- Reject summary-only or business-readable derivative files such as `*pr-summary*`.

</critical_rules>

<path_resolution_rules>

1. Ask the user for the target story/spec/plan path first if they have not already provided one clearly.
2. Before normalizing or rewriting `codeInfoStatus/flow-state/current-plan.json`, read the existing file first when it exists so any still-relevant `branched_from` values and in-scope additional repository entries can be preserved correctly.
3. If the user gives an absolute path:
   - verify that it exists and is readable;
   - verify that it is inside the current repository root;
   - convert it to a repo-relative path before writing `current-plan.json`.
4. If the user gives a relative path:
   - resolve it relative to the current repository root;
   - verify that it exists and is readable.
5. If the user gives only a filename or an incomplete path:
   - search the current repository for plausible matches using local shell tools;
   - if exactly one plausible implementation-plan match exists, use it;
   - if multiple plausible matches exist, stop and ask the user to clarify which one they want.
6. Once resolved, re-open that exact file from disk before taking any branch or handoff action.

</path_resolution_rules>

<plan_validation_rules>

- Confirm the resolved file is an executable implementation plan, not a derivative or summary artifact.
- Exclude:
  - `codeInfo_simple_stories/**`
  - `**/*pr-summary*.md`
  - any other summary-only or business-readable derivative artifacts named by the repository guidance
- Confirm the selected file is a markdown story/spec/plan file that is intended to drive implementation work.
- Confirm the story number can be identified from the selected filename before proceeding.
- If the selected file is missing, unreadable, ambiguous, or ineligible, stop and explain the exact problem rather than guessing.

</plan_validation_rules>

<branch_setup_rules>

1. Confirm what story it is and give a concise overview of the story, including what still remains to be done.
2. Re-check current repository branch state directly from git, for example with `git branch --show-current`.
3. Follow the rules within the `## Branching And Phase Flow` section of `AGENTS.md` to ensure the current repository is on the correct story branch.
4. If the current repository is not already on the correct story branch, create or reuse the correct branch and switch to it safely.
5. If this step creates the current repository branch, remember what branch or ref it was created from so it can be recorded later as `branched_from`.
6. Read the selected plan's `Additional Repositories` section if it exists. Support both `## Additional Repositories` and `### Additional Repositories`.
7. If the selected plan has no `Additional Repositories` section, treat it as a legacy single-repository plan and behave as if it said `- No Additional Repositories`.
8. Treat the current repository as the canonical plan host and as implicitly in scope.
9. Before touching any additional repository in this step, read that repository's `AGENTS.md` and follow its repository-specific workflow rules.
10. For each additional repository listed in that section, ensure it is on a branch whose story number matches the selected plan.
11. Reuse any existing matching-story branch if it is already there.
12. If no such branch exists yet, create one from that repository's current checkout so existing local changes stay attached to the new branch, and remember what branch or ref it was created from so it can be recorded later as that repository's `branched_from`.
13. If an additional repository path is missing, invalid, unreadable, or ambiguously mapped from the plan, stop and say the plan must be fixed before the current-plan handoff can be created.
14. Do NOT switch branches in any repository if doing so would overwrite local changes. Stop and say repository branch setup is blocked by local changes instead.

</branch_setup_rules>

<handoff_write_rules>

Build the canonical handoff payload using:

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

- `branched_from` is optional. Write it only when this step actually created the branch. Do NOT invent it for a reused existing branch.
- If the plan says `- No Additional Repositories`, use an empty `additional_repositories` array.
- The current repository is implicit. If it also appears inside `additional_repositories`, treat that as redundant and omit that entry from the canonical handoff payload.
- In `additional_repositories`, write repository entries as objects with a required `path` field. The optional `branched_from` field belongs inside that same object when available.
- Do not use absolute paths for `plan_path`.
- If `codeInfoStatus/flow-state/current-plan.json` does not exist, create it with that payload.
- If it already exists, preserve any existing `branched_from` value for the current repository or an additional repository that remains in scope, unless this step created that branch again and can replace it with a new concrete value.
- Remove `branched_from` only when its repository is no longer represented in the handoff.
- If the existing file already communicates the same selected `plan_path`, the same repository scope, and there are no new `branched_from` values from this run that need to be added or replaced, leave it unchanged and do NOT rewrite it.
- Otherwise, update the file in place so it matches the canonical payload for the explicitly selected plan and repository scope. Do NOT delete it first unless an in-place update is genuinely impossible.
- Treat any older, incomplete, or differently structured handoff that still communicates the same selected plan as valid input to be normalized rather than as a hard failure.
- This handoff file becomes the sole plan-selection source for every later step in the flow.
- Commit the handoff file only if you created it or changed its contents, and push if you can.

</handoff_write_rules>

<stop_conditions>

- Stop if the user has not yet identified a single unambiguous story/spec/plan file.
- Stop if repository branch setup would overwrite local changes.
- Stop if the selected plan's additional repository scope is invalid, missing, unreadable, or ambiguous.
- Stop if the selected file is not an eligible executable implementation plan.

</stop_conditions>

<output_contract>

- Report the selected story path.
- Explain whether the path was used directly, resolved from a partial input, or clarified with the user.
- Summarize what still remains to be done in the selected story.
- Report whether any repository branches were created, reused, or left unchanged.
- Report whether `codeInfoStatus/flow-state/current-plan.json` changed or stayed the same.
- If you changed the handoff file, state the commit hash and whether push succeeded.

</output_contract>

<verification_loop>

- Confirm you read `AGENTS.md`.
- Confirm the selected story came from explicit user input rather than repo-wide auto-selection.
- Confirm the selected story is not under `codeInfo_simple_stories/`.
- Confirm the selected story is an executable implementation plan, not a summary-only derivative.
- Confirm the current repository and every additional repository are on branches whose story numbers match the selected plan filename.
- Confirm you did not overwrite local changes while setting branch scope.
- Confirm the final handoff payload matches the explicitly selected story and current repository scope.

</verification_loop>
