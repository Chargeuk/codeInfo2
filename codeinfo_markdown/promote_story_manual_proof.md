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
- Re-open the exact relative `plan_path` from disk before deriving the story number.
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

- If `codeInfoStatus/manual-proof/<story-number>/` already exists, clear only that story-specific destination before deciding whether any new curated manual-proof bundle will be produced, so no stale tracked proof remains.
- If `codeInfoTmp/manual-testing/<story-number>/` does not exist, or it exists but contains no numeric task folders with eligible files, leave `codeInfoStatus/manual-proof/<story-number>/` absent. Report that no curated manual-proof bundle was produced and stop.
- For every numeric task folder that contains at least one eligible screenshot proof file, create `codeInfoStatus/manual-proof/<story-number>/task-<task-number>/`.
- Copy all eligible screenshot proof files from that task folder into the matching destination task folder, preserving basenames.
- Copy at most two support files total across the whole story.
- To choose support files, process numeric task folders in descending numeric order.
- Within each task folder, evaluate support files in this order:
  1. `support-console.txt`
  2. `support-network.json`
  3. `support-*.log` in lexicographic filename order
- Copy the first eligible support files encountered under that traversal until two total support files have been copied, then stop copying support files.
- If a selected support file comes from a task folder that had no screenshot proof files, still create the matching destination task folder before copying that support file.
- Do not copy duplicate support files with the same destination path more than once.
- Do not rename source files except for placing them under `task-<task-number>/` destination folders.
- Do not delete, move, or rewrite the source files in `codeInfoTmp/`.
- Do not copy arbitrary scratch artifacts, raw downloads, browser temp files, or unsupported logs just because the destination folder already exists.

</selection_rules>

<destination_rules>

- The curated durable bundle root for this step is `codeInfoStatus/manual-proof/<story-number>/`.
- Preserve task ownership in the durable bundle by copying into per-task subfolders:
  - `codeInfoStatus/manual-proof/<story-number>/task-<task-number>/`
- Keep all reported paths repository-relative, not absolute.
- `codeInfoStatus/manual-proof/` is durable tracked repository state. Do not treat it as ignored scratch output.
- `codeInfoTmp/manual-testing/` remains ignored scratch storage and must remain untouched apart from reading its contents.

</destination_rules>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If the selected `plan_path` is missing or unreadable, stop and report that the active plan could not be reopened from disk.
- If the destination story folder cannot be created or cleared safely, stop and report the exact path and failure.
- If copying a selected file fails, stop and report the exact source path and intended destination path.
- If some files were already copied before the failure, report that the durable manual-proof bundle is partial and should be rerun after the failure is fixed.
- Do not silently skip copy failures.

</failure_modes>

<output_contract>

- Report the selected story number.
- Report whether the curated manual-proof bundle was created, refreshed, or skipped because no eligible artifacts existed.
- Report the exact repository-relative destination root.
- Report the exact repository-relative files copied, grouped by task folder.
- Report which eligible support files were copied, if any.
- Report whether the destination story folder was cleared first.
- Report any ignored scratch files or unsupported filename patterns only when they materially explain why expected proof was not promoted.

</output_contract>

<verification_loop>

- Confirm you read `current-plan.json` first.
- Confirm you re-opened the exact active plan from disk before deriving the story number.
- Confirm you used only the active story's `codeInfoTmp/manual-testing/<story-number>/` root as the candidate source.
- Confirm you treated only numeric child directories as task folders.
- Confirm you copied only approved filename patterns.
- Confirm you copied all eligible screenshot proof files from every qualifying task folder.
- Confirm you copied no more than two support files total.
- Confirm support files were selected by descending task number, then by the defined per-folder priority order.
- Confirm the durable destination preserved per-task subfolders under `codeInfoStatus/manual-proof/<story-number>/`.
- Confirm you did not modify or delete source artifacts in `codeInfoTmp/`.
- Confirm you did not edit the plan in this step.
- Confirm you did not commit or push in this step.

</verification_loop>
