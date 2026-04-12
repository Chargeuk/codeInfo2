# Goal

Decide whether the currently selected story is honestly complete using the canonical parser rather than visual scanning or conversational memory.

<task>

Read the stored current-plan handoff first and use only that scope for this step.
Re-open the exact active plan file from disk before judging completion.
Verify repository branch scope still matches the selected story.
Then run `python3 scripts/plan_status.py` and use that JSON output as the source of truth for story state.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before deciding whether the story is complete.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<branch_rules>

- Verify that the current repository branch story number matches the selected plan filename story number.
- Verify that every additional repository still exists, is readable, and is on a matching-story branch.
- If any scope or branch check fails, stop and report drift or stale handoff instead of answering completion normally.

</branch_rules>

<parser_rules>

- Run `python3 scripts/plan_status.py`.
- Use the parser output as the only source of truth for `all_tasks_done`, `story_complete`, `final_task_status`, `tasks_with_live_blockers`, `tasks_with_unchecked_subtasks`, `tasks_with_unchecked_testing`, and `inconsistent_done_tasks`.
- Do not answer story completion from task prose alone.
- Treat any parser-reported `inconsistent_done_tasks` entry as a structural completion blocker until that task is reopened or its checklist state is made honest.

</parser_rules>

<output_contract>

When reporting the result, include:

1. whether the story is complete;
2. `final_task_status`;
3. whether repository branch scope matches the selected story;
4. if the story is not complete, the exact parser reason:
   - `tasks_with_live_blockers`
   - `tasks_with_unchecked_subtasks`
   - `tasks_with_unchecked_testing`
   - `inconsistent_done_tasks`

</output_contract>

<verification_loop>

- Confirm you re-read `current-plan.json`.
- Confirm you re-opened the exact stored plan file from disk.
- Confirm repository branch scope still matches the selected story before answering completion.
- Confirm you used `python3 scripts/plan_status.py` as the source of truth for story state.
- Confirm you reported parser reasons when completion was false instead of only returning a bare negative conclusion.

</verification_loop>
