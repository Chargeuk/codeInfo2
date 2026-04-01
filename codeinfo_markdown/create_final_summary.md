# Goal

Append a final summary to the active canonical plan using fresh disk reads so the summary reflects the latest plan and story state rather than conversational memory.

<task>

Read the stored current-plan handoff first and use only that scope for this step.
Re-open the exact active plan file from disk before summarizing.
Append a new section named `## Final Summary` to the end of that plan.
Base the summary on the latest plan content, implementation notes, testing state, and review-relevant hotspots that exist on disk now.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact relative `plan_path` from disk before writing the summary, even if you read it earlier in the flow.
- Use fresh disk reads and current git state, not conversational memory.
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

</content_rules>

<verification_loop>

Before finishing:

- confirm you re-read `current-plan.json`;
- confirm you re-opened the exact plan from disk immediately before summarizing;
- confirm the summary reflects the latest task/testing/review state present in the plan;
- confirm multi-repository scope is covered when applicable.

</verification_loop>
