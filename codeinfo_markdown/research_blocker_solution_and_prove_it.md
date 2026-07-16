# Goal

Research the current blocker, prove the best technical solution, and record that proof in the plan before work continues.

<task>

Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
Read the stored current-plan handoff and use only that scope for this step.
Read `codeInfoStatus/flow-state/current-task.json` from disk if it exists, for example with `cat codeInfoStatus/flow-state/current-task.json`, and determine its meaning from what it contains rather than depending on an exact JSON shape.
Load a fresh bounded blocker-repair packet before checking for blockers.
If the current implementation does not contain a blocker, state that and stop.
If the current implementation contains a blocker, you MUST research and prove the solution before work continues.
Write the proven blocker answer into the implementation notes marked as `**BLOCKING ANSWER**`.
Keep the task's existing parser-visible `**BLOCKER**` line intact while the required external state, terminal artifact, or prerequisite remains unavailable. A proven retry recipe is context, not blocker resolution. Do not rename the live blocker to `**RESOLVED ISSUE**`, remove it, or claim it is retired unless fresh evidence proves the blocking condition itself changed.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile blocker-repair --task current` before checking blockers or implementation notes.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<blocker_detection_rules>

- Before deciding whether the current implementation contains a blocker, read `$CODEINFO_ROOT/codeinfo_markdown/shared/blocker-detection.md`.
- If `current-task.json` clearly resolves a bound task, determine that task number from its contents and run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <that-number>`.
- If `current-task.json` instead says plan repair is still needed and does not clearly resolve one task, say that explicitly and use the current repaired plan state on disk only as a fallback to understand whether a single blocker owner now exists.
- Only when that fallback is necessary may you run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --selector active_or_done`.
- Use the parser output, not visual scanning, to determine whether the selected task contains any live blocker lines.
- Treat only lines reported by the parser under `selected_task.live_blockers` as the current live blocker state for this step.
- If the parser reports no live blocker lines for the selected task, state that no current blocker is present and stop.

</blocker_detection_rules>

<research_rules>

If the implementation notes contain a blocker, your research must cover all of the following:

1. Pattern research

- use the `code_info` tool to see how other ingested repositories solve the same class of problem
- use repository evidence first
- prefer existing repository and official library solutions over invented approaches

2. External-library and framework confirmation

- use DeepWiki, Context7, and targeted web research when the blocker involves external libraries or frameworks
- distinguish intended supported usage from accidental workarounds

3. Exact issue-resolution research

- research the exact blocker, error, or failure mode itself using official docs and targeted web searches
- identify how other engineers resolve the same concrete issue in practice
- distinguish between temporary workarounds, proper fixes, and anti-patterns

4. Blocker-family classification

- classify the blocker as one of: product or story seam; proof or test harness seam; shared wrapper or baseline seam; manual or runtime environment seam; task-shape or planning seam
- state whether the current task actually owns the blocker, or whether the evidence points to prerequisite baseline, harness, runtime-handoff, or task-shape repair

</research_rules>

<proof_rules>

Before editing the plan, you MUST prove the chosen solution by recording:

- the repository precedents you found;
- the external-library precedents you found;
- the issue-resolution references you found;
- why the chosen fix fits the current local repo state;
- which blocker family applies and why the current task does or does not own it;
- why the rejected alternatives were not suitable.

Write that answer into the implementation notes marked as `**BLOCKING ANSWER**`.

</proof_rules>

<behavior_rules>

- Do not ask the user questions or offer options in this step.
- Do not leave the blocker unresearched if repository evidence and external evidence can settle it.
- Do not mutate the plan structure here unless a tiny note is absolutely required to make the blocker answer visible.
- Do not invent unsupported runtime seams, test harnesses, or library behavior.
- Do not recommend repeated broad-wrapper reruns, longer waits, or manual-runtime retries when the blocker family shows a missing baseline, harness, runtime handoff, or task-shape owner.

</behavior_rules>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. whether a blocker was present;
2. the chosen solution;
3. the strongest evidence that proved it;
4. whether a `**BLOCKING ANSWER**` note was written.

</output_contract>

<verification_loop>

Before finishing:

- confirm you used a fresh bounded blocker-repair packet;
- confirm the blocker was identified from current implementation notes rather than memory;
- confirm repository precedents and external precedents were gathered when relevant;
- confirm the chosen solution was proved rather than merely suggested;
- confirm the implementation notes now contain a `**BLOCKING ANSWER**` when a blocker existed;
- confirm tracked changes were committed if any were made.

</verification_loop>
