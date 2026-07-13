# Goal

Create or update the simple-story companion document so business readers have a lightweight summary of the now-tasked story, then create one coherent final commit for this command if files changed.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Use fresh disk reads and current git state, not conversational memory.
- Base the simple story on the active plan after all tasking edits are complete.
- If a simple-story file already exists for this story, update it instead of creating a duplicate.
- Keep the simple story concise, business-readable, and aligned with the final tasked plan.

</instruction_priority>

<source_priority>

- Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile closeout` after the final tasking pass has completed.
- Run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --include-tasks` and use its final task list rather than relying on memory or earlier drafts.
- Reuse the structure and intent from `$CODEINFO_ROOT/codeinfo_markdown/create_simple_story.md`, but keep this pass aligned to the final tasked plan and current command ownership.

</source_priority>

<story_update_rules>

- The simple-story file must live at `codeInfo_simple_stories/<same-plan-filename>`.
- Derive the simple-story title, acceptance list, description, and task summary from the final tasked plan, not from older drafts.
- Keep the simple story non-secret and portable:
  - do not include absolute filesystem paths;
  - do not include usernames, checkout roots, or machine-specific locations;
  - do not inline secrets, passwords, tokens, or raw credential values.
- The `# Tasks` section should summarize the final tasked plan in the lightweight format expected by `create_simple_story.md`, but keep it synchronized with the real repository-owned task order.
- If the final tasked plan changed task titles, repository ownership, or proof expectations, update the simple story so it still matches the latest plan truthfully.
- If no simple-story update is needed after verification, leave the existing file unchanged.

</story_update_rules>

<verification_loop>

- Check that the simple-story file exists after this pass.
- Check that its filename matches the active plan filename.
- Check that its content reflects the final tasked plan rather than an earlier draft.
- Check that the simple story stays concise, business-readable, and free of absolute paths or secret material.
- Check that the summarized task list still matches the final repository-owned task order in the real plan.

</verification_loop>

<commit_policy>

- If this command changed files, create one commit after the simple-story verification pass.
- Follow the repository's commit-message and branch conventions from `AGENTS.md` or other repository-specific instructions when they exist.
- If no repository-specific commit convention exists, use a concise commit subject and a short explanatory body.
- If nothing changed, do not create an empty commit.

</commit_policy>

<output_contract>

- Report briefly what changed, what was verified, and whether a commit was created.
- Do not ask questions; finish the simple-story update and commit when possible.

</output_contract>
