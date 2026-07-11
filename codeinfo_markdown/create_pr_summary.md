# Goal

Create or update the durable reviewer-facing PR summary artifact for the active story in the canonical repository-owned location.

<task>

Read the stored current-plan handoff first and use only that scope for this step.
Load the bounded closeout packet immediately before writing.
Derive the story number from the active plan filename.
Create or update `codeInfoStatus/pr-summaries/<story-number>-pr-summary.md`.
Inspect `codeInfoStatus/manual-proof/<story-number>/` if it exists and treat it as part of the repository-owned closeout state for this story.
Use the final plan state on disk as the source of truth, especially the latest `## Final Summary` section when it exists.
Do not create or update any reviewer summary under `planning/` in this step.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile closeout` before writing, even if you loaded earlier context.
- Use fresh disk reads and current git state, not conversational memory.
- If the story scope includes additional repositories, the summary must cover that multi-repository scope truthfully.

</scope_rules>

<content_rules>

- Write the artifact to `codeInfoStatus/pr-summaries/<story-number>-pr-summary.md`.
- Keep the file concise and reviewer-facing.
- Treat the plan's `## Final Summary` as the primary source when it exists.
- When `codeInfoStatus/manual-proof/<story-number>/` exists, mention that repository-relative manual-proof bundle path briefly in the PR summary.
- If the plan also contains `Post-Implementation Code Review` or `Code Review Findings`, reflect the resulting final review state briefly so the PR summary does not contradict the plan.
- Do not invent test results, review outcomes, or repository scope details that are not present on disk.
- Keep repository references portable and repository-relative where possible.
- If the artifact already exists and the final plan state has not materially changed its content, leave it unchanged.
- Do not recreate, update, or retain a second reviewer-summary artifact under `planning/`; the canonical repository-owned location is `codeInfoStatus/pr-summaries/`.

</content_rules>

<suggested_shape>

Use a compact markdown shape such as:

```md
# Story <story-number> PR Summary

- Plan: `<plan_path>`
- Repository scope: `<current repository>` plus any additional repositories in scope
- Manual proof bundle: `codeInfoStatus/manual-proof/<story-number>/` when present

## Final Summary

1. ...
2. ...
3. ...
4. ...

## Review Status

- <brief final review / validation note based on the plan's latest state>
```

You may adjust the headings slightly if the final result is clearer, but keep the file short and stable.

</suggested_shape>

<verification_loop>

- confirm you re-read `current-plan.json`;
- confirm you loaded a fresh bounded closeout packet immediately before writing;
- confirm the artifact was written under `codeInfoStatus/pr-summaries/` and not under `planning/`;
- confirm the content reflects the latest final-summary and review state present in the plan;
- confirm any mentioned `codeInfoStatus/manual-proof/<story-number>/` bundle actually exists on disk;
- confirm multi-repository scope is covered when applicable;
- confirm you did not create or update a second reviewer-summary artifact in `planning/`.

</verification_loop>

<output_contract>

- Report whether the PR summary was created, updated, or left unchanged.
- Report the exact repository-relative artifact path.
- Mention briefly which plan sections were used as the source of truth and whether a curated manual-proof bundle was referenced.

</output_contract>
