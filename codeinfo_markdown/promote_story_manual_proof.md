# Goal

Promote curated story-level manual-proof artifacts from ignored per-task scratch storage into a durable repository-owned proof bundle using only fresh disk reads and the active plan scope.

<task>

Read the stored current-plan handoff first and use only that scope for this step.
Derive the story number from the selected active plan filename.
Inspect `codeInfoTmp/manual-testing/<story-number>/` for numeric task folders that represent the latest manual-testing pass for each task.
Create or refresh `codeInfoStatus/manual-proof/<story-number>/` by copying only approved proof artifacts from those task folders into matching `task-<task-number>/` subfolders.
Do not move or delete the source files in `codeInfoTmp/`.
Do not edit the active plan in this step.
Do not commit or push in this step.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Treat the current repository as in scope even if it is not listed in `additional_repositories`.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile closeout` before deriving story and final-task proof ownership.
- Use fresh disk reads and current filesystem state, not conversational memory.
- Do not search for a different story and do not infer a different repository scope.
- Do not use `code_info` for this step unless direct repository reads are genuinely insufficient, which should be rare here.

</scope_rules>

<input_rules>

- Treat `codeInfoTmp/manual-testing/<story-number>/` as the only source root for candidate scratch manual-proof artifacts in the current repository.
- Treat only immediate child directories whose names are purely numeric as task folders.
- Ignore any non-numeric child directories, files at the story root, hidden files, editor backups, and unrelated scratch files.
- Within each numeric task folder, only these files are eligible for promotion:
  - screenshot proof files matching `proof-*.png`, `proof-*.jpg`, `proof-*.jpeg`, or `proof-*.webp`
  - `support-console.txt`
  - `support-network.json`
  - support log files matching `support-*.log`
- Ignore every other file type or filename pattern, even if it looks useful.
- Do not invent additional allowed filename patterns in this step.

</input_rules>

<selection_rules>

- First determine whether `codeInfoTmp/manual-testing/<story-number>/` exists and contains any numeric task folders with eligible files.
- If `codeInfoTmp/manual-testing/<story-number>/` does not exist, or it exists but contains no numeric task folders with eligible files, do not modify any existing `codeInfoStatus/manual-proof/<story-number>/` bundle. Report that no new curated manual-proof bundle was produced in this pass and that any existing durable bundle was left unchanged, then stop.
- Identify the numeric task folders that contain promotable files in this pass as candidate task folders.
- Do not clear or rebuild `codeInfoStatus/manual-proof/<story-number>/` as a whole. Preserve any durable task folders whose task numbers are not selected for replacement in the current promotion run unless they are explicitly identified as superseded durable screenshot folders that are safe to prune under the rules below.
- Prefer the latest screenshot proof that represents the story's current final state instead of preserving every earlier screenshot by default.
- Determine which candidate task folders contain eligible screenshot proof files.
- If no candidate task folder contains eligible screenshot proof files, do not select any screenshot proof files in this pass; continue evaluating support files separately under the rules below.
- Define the `final story task` for this step as the highest-numbered task in the active plan that owns story implementation or story proof, rather than a separate flow/meta step outside the task list.
- Identify the highest-numbered candidate task folder that contains eligible screenshot proof files as the default latest screenshot-proof source.
- If that highest-numbered screenshot-owning task folder does not belong to the final story task, treat it as the default screenshot-proof source for this pass and retain earlier screenshots only when they still appear uniquely necessary.
- If that highest-numbered screenshot-owning task folder belongs to the final story task, use the closeout packet plus the latest task-level manual-proof notes to determine whether that final task's manual proof re-covered the relevant story-owned visual surfaces in their current final state.
- If the available plan and manual-proof context indicates that the final task re-covered those visual surfaces, select screenshot proof from that final task folder only by default and treat earlier screenshots for the same surfaces as superseded scratch proof.
- Retain earlier-task screenshots only when repository-visible evidence shows they still provide uniquely necessary proof for a required visual surface that the final task did not honestly re-prove.
- When the available evidence is ambiguous, preserve plausibly unique earlier screenshot proof rather than discarding it aggressively.
- When current-run evidence clearly shows that a later selected screenshot set supersedes an existing durable screenshot task folder for the same surfaces, and that older task contributes no selected screenshots or selected support files in the current run, mark that existing durable folder as a superseded durable screenshot folder to prune.
- A durable `task-<task-number>/` folder is safe to prune only when all of these are true:
  1. the durable folder already exists under `codeInfoStatus/manual-proof/<story-number>/`
  2. the current promotion run selected later screenshot proof that supersedes the screenshot proof previously owned by that durable folder
  3. the older task has no selected screenshot files in the current run
  4. the older task has no selected support files in the current run
  5. the available evidence is not ambiguous
- When the available evidence is ambiguous, or when the older durable folder may still own uniquely necessary proof, do not prune that durable folder; preserve it unchanged unless it is being actively replaced by selected files for the same task in the current run.
- After a screenshot-owning task folder has been selected to own screenshot proof for this run, copy every eligible `proof-*` image file from that folder by default as selected screenshot proof unless another rule above explicitly treats that screenshot set as superseded or preserves only uniquely necessary earlier screenshot proof for a required surface.
- Preserve screenshot basenames when copying selected screenshot proof files.
- Copy at most two support files total across the whole story.
- To choose support files, process numeric task folders in descending numeric order.
- Within each task folder, evaluate support files in this order:
  1. `support-console.txt`
  2. `support-network.json`
  3. `support-*.log` in lexicographic filename order
- Copy the first eligible support files encountered under that traversal until two total support files have been copied, then stop copying support files.
- After applying the screenshot and support-file selection rules, treat only the task numbers that have at least one selected file as selected task folders for this promotion run.
- Keep `selected task folders` and `superseded durable screenshot folders to prune` as separate concepts in this step. Selected task folders are staged and replaced because they have selected files in the current run. Superseded durable screenshot folders to prune are existing durable folders that should be removed because later selected screenshot proof superseded them and they no longer contribute selected files in the current run.
- If a candidate task folder ends up with zero selected files after the support-file cap and selection rules are applied, leave any existing durable `task-<task-number>/` folder unchanged unless that durable folder was explicitly marked as a superseded durable screenshot folder that is safe to prune.
- For every selected task folder, stage its selected files into a temporary destination such as `codeInfoStatus/manual-proof/<story-number>/task-<task-number>.tmp/` before replacing the durable task folder for that one task.
- If a selected support file comes from a task folder that had no screenshot proof files, still create the matching temporary destination for that selected task before copying that support file.
- Replace a durable `task-<task-number>/` folder only after all selected files for that same selected task have been copied successfully into its temporary destination.
- If a selected task has no existing durable folder yet, promote it by renaming or moving the completed temporary destination into `task-<task-number>/`.
- After all selected task folders have either been replaced successfully or preserved unchanged because they were not selected, prune only the durable task folders that were explicitly identified as superseded durable screenshot folders and were safe to prune under the rules above.
- Do not copy duplicate support files with the same destination path more than once.
- Do not rename source files except for placing them under `task-<task-number>/` destination folders.
- Do not delete, move, or rewrite the source files in `codeInfoTmp/`.
- Do not copy arbitrary scratch artifacts, raw downloads, browser temp files, or unsupported logs just because the destination folder already exists.

</selection_rules>

<destination_rules>

- The curated durable bundle root for this step is `codeInfoStatus/manual-proof/<story-number>/`.
- Preserve task ownership in the durable bundle by copying into per-task subfolders:
  - `codeInfoStatus/manual-proof/<story-number>/task-<task-number>/`
- Use temporary per-task staging folders such as `codeInfoStatus/manual-proof/<story-number>/task-<task-number>.tmp/` only for selected task folders during the copy phase, and remove them after a successful replace or a failed staged attempt.
- Keep all reported paths repository-relative, not absolute.
- `codeInfoStatus/manual-proof/` is durable tracked repository state. Do not treat it as ignored scratch output.
- `codeInfoTmp/manual-testing/` remains ignored scratch storage and must remain untouched apart from reading its contents.

</destination_rules>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If the selected `plan_path` is missing or unreadable, stop and report that the active plan could not be reopened from disk.
- If a temporary or durable per-task destination cannot be created safely, stop and report the exact path and failure.
- If copying a selected file for a selected task fails, stop and report the exact source path, intended temporary destination path, and task number.
- If staging a selected task fails, leave any existing durable `task-<task-number>/` folder unchanged and report that the task-level promotion did not replace prior durable proof for that task.
- If pruning a superseded durable screenshot folder fails, stop and report the exact durable path that could not be removed.
- If a candidate task has zero selected files after the support-file cap is applied, or because its screenshots were superseded by later final-state proof and it contributed no selected support files, treat that as a preserve-unchanged outcome rather than a failure.
- Do not silently skip copy failures.

</failure_modes>

<output_contract>

- Report the selected story number.
- Report whether the curated manual-proof bundle was created, refreshed, or skipped because no eligible artifacts existed.
- When no eligible scratch artifacts existed, report whether an existing durable bundle was preserved unchanged or no durable bundle existed yet.
- Report which task numbers were candidate task folders in the current promotion run.
- Report which candidate task folders owned eligible screenshot proof files.
- Report which task numbers were selected task folders in the current promotion run.
- Report which durable task folders were explicitly identified as superseded durable screenshot folders to prune in the current promotion run.
- Report which durable task folders were replaced, newly created, or preserved unchanged.
- Report which durable task folders were pruned as superseded, if any.
- Report whether latest-final-state screenshot preference was applied.
- Report which earlier screenshot task folders were skipped as superseded by later final-state proof, if any.
- Report which earlier screenshot task folders were retained because they still appeared uniquely necessary or because the available evidence was ambiguous.
- Report which candidate task folders were preserved unchanged because they ended up with zero selected files.
- Report the exact repository-relative destination root.
- Report the exact repository-relative files copied, grouped by task folder.
- Report which eligible support files were copied, if any.
- Report whether any task-level temporary staging folders were used and cleaned up.
- Report any ignored scratch files or unsupported filename patterns only when they materially explain why expected proof was not promoted.

</output_contract>

<verification_loop>

- Confirm you read `current-plan.json` first.
- Confirm you used a fresh bounded closeout packet before deriving story and final-task proof ownership.
- Confirm you used only the active story's `codeInfoTmp/manual-testing/<story-number>/` root as the candidate source.
- Confirm you treated only numeric child directories as task folders.
- Confirm you copied only approved filename patterns.
- Confirm you applied the latest-final-state screenshot preference rules instead of copying every earlier screenshot by default.
- Confirm you kept earlier screenshots only when they still appeared uniquely necessary or when the available evidence was ambiguous.
- Confirm you pruned durable screenshot task folders only when current-run evidence clearly showed they were superseded and safe to prune.
- Confirm you copied no more than two support files total.
- Confirm support files were selected by descending task number, then by the defined per-folder priority order.
- Confirm only task folders with at least one selected file were treated as selected task folders and staged for replacement.
- Confirm no durable task folder with selected files or selected support files was pruned.
- Confirm the durable destination preserved untouched per-task subfolders under `codeInfoStatus/manual-proof/<story-number>/`.
- Confirm candidate task folders with zero selected files were preserved unchanged unless an existing durable folder for that task was explicitly identified as superseded and safe to prune.
- Confirm each replaced durable task folder was updated only after successful staging for that same selected task.
- Confirm the support-file cap did not cause an empty durable task replacement.
- Confirm you did not delete an existing durable bundle merely because no new eligible scratch artifacts were available in this pass.
- Confirm you did not delete an existing durable task folder merely because a different task was not retested in this pass; delete durable task folders only when the current-run supersession rules explicitly marked them safe to prune.
- Confirm you did not modify or delete source artifacts in `codeInfoTmp/`.
- Confirm you did not edit the plan in this step.
- Confirm you did not commit or push in this step.

</verification_loop>
