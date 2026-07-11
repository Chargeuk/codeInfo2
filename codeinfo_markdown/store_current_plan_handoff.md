# Goal

Select the active implementation story only when the current handoff is missing, stale, unreadable, or already complete, then ensure branch scope matches that story and normalize `codeInfoStatus/flow-state/current-plan.json`.

<critical_rules>

- Read the repository `AGENTS.md` first and follow its repository-specific guidance about where executable story/spec/plan files may live.
- Reuse the existing `codeInfoStatus/flow-state/current-plan.json` handoff if it still points at a readable story/spec/plan file that is honestly still in progress. Do NOT rediscover a different story in that case.
- Only search for a new story when the current handoff is missing, unreadable, stale, or points at a fully complete story.
- Executable implementation plans may live in `planning/` or elsewhere in the repository, but you MUST exclude summary-only or business-readable derivative folders such as `codeInfo_simple_stories/`.
- Never select a file inside `codeInfo_simple_stories/` as the active implementation plan.
- If both a detailed implementation plan and a simple-story derivative exist for the same story number, only the detailed implementation plan is eligible for handoff selection.
- Use fresh disk reads and current git state, not conversational memory.
- Do NOT use code_info tools for story selection in this step.

</critical_rules>

<handoff_reuse_rules>

1. If `codeInfoStatus/flow-state/current-plan.json` exists, read it first.
2. Determine the active `plan_path` from the information it contains rather than from an exact JSON shape.
3. If the file identifies a readable story/spec/plan file:
   - run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --plan <plan_path>` to check whether it is still honestly in progress;
   - if it is, treat that as the selected story and do NOT search for a different one.
4. Treat the existing handoff as stale and continue to fresh story selection only if:
   - the file is missing;
   - the selected `plan_path` cannot be determined;
   - the selected file is missing or unreadable;
   - the selected file is not an executable implementation plan under the current repository rules;
   - or the selected file is fully complete.

</handoff_reuse_rules>

<candidate_scope_rules>

- If fresh story selection is required, search the repository for executable story/spec/plan files according to the repository's `AGENTS.md`.
- Include implementation plans that live outside `planning/` when the repository guidance permits that.
- Exclude:
  - `codeInfo_simple_stories/**`
  - `**/*pr-summary*.md`
  - any other summary-only or business-readable derivative artifacts named by the repository guidance
- When evaluating candidates, prefer files that already contain task-status tracking with open work.
- Only if no eligible task-tracked implementation plan remains open may you choose the lowest-numbered untasked implementation story/spec file.
- Do not let a lower-numbered excluded derivative file outrank a higher-numbered active implementation plan.

</candidate_scope_rules>

<selection_order>

1. First prefer the existing handoff if it still points at an active in-progress implementation plan.
2. Otherwise, among eligible executable implementation plans, select the lowest-numbered file that already contains task-status tracking and still has open work.
3. Only if no such file exists, select the lowest-numbered eligible untasked implementation story/spec file.
4. Once selected, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --plan <selected-plan> --profile story-scope`, and use that bounded story packet before taking any branch or handoff action.

</selection_order>

<branch_setup_rules>

1. Confirm what story it is and give a concise overview of the story, including what still remains to be done.
2. Re-check current repository branch state directly from git, for example with `git branch --show-current`.
3. Follow the rules within the `## Branching And Phase Flow` section of `AGENTS.md` to ensure the current repository is on the correct story branch.
4. If the current repository is not already on the correct story branch, create or reuse the correct branch and switch to it safely.
5. If this step creates the current repository branch, remember what branch or ref it was created from so it can be recorded later as `branched_from`.
6. Use the bounded story packet's `Additional Repositories` section when present. If the plan uses a task-level variant, request only that named section with `plan_sections.py`.
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
- Otherwise, update the file in place so it matches the canonical payload for the selected plan and repository scope. Do NOT delete it first unless an in-place update is genuinely impossible.
- Treat any older, incomplete, or differently structured handoff that still communicates the same selected plan as valid input to be normalized rather than as a hard failure.
- This handoff file becomes the sole plan-selection source for every later step in the flow.
- Commit the handoff file only if you created it or changed its contents, and push if you can.

</handoff_write_rules>

<stop_conditions>

- Stop if repository branch setup would overwrite local changes.
- Stop if the selected plan's additional repository scope is invalid, missing, unreadable, or ambiguous.
- Stop if no eligible executable implementation plan can be identified honestly from disk.

</stop_conditions>

<output_contract>

- Report the selected story path.
- Explain whether the existing handoff was reused or replaced.
- Summarize what still remains to be done in the selected story.
- Report whether any repository branches were created, reused, or left unchanged.
- Report whether `codeInfoStatus/flow-state/current-plan.json` changed or stayed the same.
- If you changed the handoff file, state the commit hash and whether push succeeded.

</output_contract>

<verification_loop>

- Confirm you read `AGENTS.md`.
- Confirm you checked the existing handoff first before rediscovering a story.
- Confirm the selected story is not under `codeInfo_simple_stories/`.
- Confirm the selected story is an executable implementation plan, not a summary-only derivative.
- Confirm the current repository and every additional repository are on branches whose story numbers match the selected plan filename.
- Confirm you did not overwrite local changes while setting branch scope.
- Confirm the final handoff payload matches the selected plan and current repository scope.

</verification_loop>
