# Goal

Append a final summary to the active canonical plan using fresh disk reads so the summary reflects the latest plan and story state rather than conversational memory.

<task>

Read the stored current-plan handoff first and use only that scope for this step.
Load the bounded closeout packet before summarizing.
Derive the story number from the active plan filename.
Inspect `codeInfoStatus/manual-proof/<story-number>/` if it exists and treat that curated bundle as part of the story-closeout state on disk.
Append a new section named `## Final Summary` to the end of that plan.
Base the summary on the latest plan content, implementation notes, testing state, and review-relevant hotspots that exist on disk now.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile closeout` before writing the summary, even if you loaded earlier context.
- Use fresh disk reads and current git state, not conversational memory.
- When the current repository contains `codeInfoStatus/manual-proof/<story-number>/`, use that repository-relative bundle path as additional closeout evidence. Do not invent that bundle when the folder is absent.
- If the story scope includes additional repositories, the summary must cover changes and reviewer hotspots across all repositories in scope, not just the current repository.

</scope_rules>

<content_rules>

Write the final summary as a numbered list with these four items:

1. What has been changed.
2. Why it changed.
3. A simple explanation of any complex logic that needed to be added.
4. What a reviewer should take particular interest in.

Keep the summary concise, but make sure it reflects the latest state of the plan on disk rather than an earlier snapshot.
This summary will later be used as the summary comment added to the code review.
When `codeInfoStatus/manual-proof/<story-number>/` exists, mention that curated repository-relative proof bundle briefly in the summary, usually as part of reviewer focus or closeout evidence. Do not enumerate every file unless that is genuinely needed for clarity.

</content_rules>

<verification_loop>

Before finishing:

- confirm you re-read `current-plan.json`;
- confirm you loaded a fresh bounded closeout packet immediately before summarizing;
- confirm the summary reflects the latest task/testing/review state present in the plan;
- confirm any mentioned `codeInfoStatus/manual-proof/<story-number>/` bundle actually exists on disk;
- confirm multi-repository scope is covered when applicable.

</verification_loop>
