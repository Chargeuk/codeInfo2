# Goal

Read `$CODEINFO_ROOT/codeinfo_markdown/shared/review-wave-consumer-contract.md` first and make changes only in the finding's owning target repository.

Fix exactly one unresolved review finding that the current review disposition state routed or promoted into the inline-fix queue.

This step performs the code/config/docs/test edit for one routed inline-fix finding only. It does not task up findings, generate final revalidation tasks, or document the fix in the plan.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"`.
- Use only the stored `plan_path`, `additional_repositories`, and review disposition state as the active scope.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-scope` before touching files. Request the selected finding's owning task sections separately if the disposition state identifies one.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Do not rediscover review artifacts by timestamp.
- If `needs_minor_fix_path` is not true, do not change repository files. Write a skipped result and stop.
- Select exactly one finding from `unresolved_minor_batchable_findings`, preferably the first listed item unless the state names a selected finding.
- Treat this queue as the review loop's inline-fix queue, not merely as tiny-cleanup work. Re-inspect the selected finding and the relevant source files, create the required internal one-shot resolution plan, and make every safe concrete attempt allowed by the rules below before deciding that task-up is required.
- Do not perform manual browser, Playwright MCP, or agent-driven validation.
- Do not run broad final validation in this step. Run only bounded local automated proof that is directly needed for the selected minor fix. This may include a small test update or one or two new focused tests in the owning repository.
- If the step is going to exit with `status = fixed` and tracked files were changed, commit them before finishing this step.
- If the step is going to exit with any status other than `fixed`, do not commit. Revert any tracked edits made during this minor-fix attempt before writing the terminal result so the next loop pass does not inherit this attempt's partial tracked changes.
- When `status` is `fixed`, `commit_sha` MUST be the exact full 40-character git commit SHA for the newly created fix commit. Do not write a guessed expansion of a short SHA, and do not copy a short SHA into this field.
- Resolve that exact SHA from git after the fix commit is created, for example with `git rev-parse HEAD` or `git rev-parse <new-short-sha>`.
- Do not push.

</critical_rules>

<target_repository_rules>

- Resolve the selected finding's repository from its `repository` field.
- If the repository is `Current Repository`, use the current repository root.
- If the repository refers to an additional repository, resolve it from `additional_repositories` or from the `repositories` entries in `review-disposition-state.json`.
- Before touching files in the target repository, read that repository's `AGENTS.md` if it exists and follow its workflow rules.
- Verify the target repository branch story number still matches the selected plan filename story number. If it does not, write a blocked result and stop.
- Do not stash, reset, discard, or overwrite pre-existing local changes. If pre-existing local changes would make the minor fix unsafe to isolate, write a blocked result and stop. This does not prevent reverting tracked edits created by the current failed minor-fix attempt before a non-`fixed` exit.

</target_repository_rules>

<attempt_first_execution_rules>

- Before editing or returning `reclassify_task_required`, internally create a one-shot resolution plan for the selected finding that identifies:
  - the evidence-backed root cause;
  - the exact in-scope behavior to restore or establish;
  - the files and implementation seams likely to change;
  - the focused automated proof needed;
  - the important scope, contract, and repository-safety constraints.
- Follow that plan immediately when it identifies a safe in-scope implementation that can be completed in this coding pass.
- After each edit, run the focused proof needed for the finding. If proof fails, diagnose the failure, revise the plan or implementation, and retry while a safe concrete next action remains.
- Do not repeat the same failed code change and proof command without new evidence. Continue only when the next attempt follows a new diagnosis, makes a materially different safe change, or runs focused proof that can reveal new information. If no new safe action remains, record the evidence and return `reclassify_task_required` unless a separate operational blocker requires `blocked`.
- Do not stop merely because the first approach failed, more than one file is involved, the finding was initially classified as task-required, or the implementation is more substantial than expected.
- Treat an original task-required reason preserved by `promote_actionable_review_findings_to_minor_path.md` as risk and scope context. It is not by itself evidence that the required inline attempt should be skipped.
- Return `reclassify_task_required` only after fresh source inspection and the one-shot plan show that no safe bounded in-scope implementation can be completed under this path's existing contract. State the specific wider contract choice, lifecycle redesign, multi-surface coordination, multi-repository change, or other planning dependency that prevents completion here.
- Return `blocked` only for an operational, handoff, repository-safety, or proof-safety interruption that leaves no safe concrete next action in this pass. Complexity, unfamiliar code, or a failing test with a diagnosable next step is not a blocker.
- Keep the one-shot plan internal. Report its relevant evidence through the terminal result's summary, proof notes, reclassification reason, or blocker rather than creating a separate planning artifact.

</attempt_first_execution_rules>

<fix_rules>

- Keep the edit minimal and directly tied to the selected finding.
- Do not combine unrelated findings in one fix.
- Findings routed into this path should be treated as inline-fix candidates first, even when they are more substantial than a trivial cleanup, as long as the work still fits one bounded same-repository coding pass.
- A minor fix may include one or two small focused automated test updates or additions in the owning repository when that keeps the change bounded and honest.
- A minor fix may still restore an already intended same-repository contract, validation parity, or route-check ordering when that work remains bounded to one clear seam and does not broaden into a larger contract redesign.
- A bounded producer-consumer alignment fix may remain minor when it restores an already-settled returned-result contract in one same-repository service or helper seam.
- A bounded validation-order fix may remain minor when it moves malformed-input or unsupported-input validation ahead of dependency I/O to restore an already-settled request contract.
- A bounded dead-branch cleanup in a queue, lifecycle, or concurrency-sensitive helper may remain minor when source inspection confirms the branch is unreachable under the current live-state or query contract.
- When the classifier has already placed the selected finding in the minor path and fresh source inspection still shows one bounded same-repository seam, prefer attempting the repair first rather than immediately reclassifying it back to task-required.
- For a cross-surface error-classification finding promoted from an initial task-required disposition, use fresh source inspection and the one-shot plan to look for an already-settled same-repository contract and one bounded outlier alignment before reclassifying it. Do not reinterpret a shared error taxonomy or choose between competing public contracts in this path.
- If the selected finding's routed `reason` says the reviewer's suggested remedy is outside approved story scope, treat that routed `reason` as the binding downstream contract for this step. Do not adopt the reviewer-proposed behavior change automatically.
- Do not go back to the findings artifact or external-review adjudication trail to reinterpret that distinction in this step unless a later prompt explicitly instructs you to do so. This step should consume the classifier's routed state, not invent a second downstream scope interpretation.
- Minor review fixes may repair code within approved story scope, including bounded restoration of previously approved or preserved behavior that the current story itself regressed, but they must not introduce new out-of-scope user-facing behavior changes.
- When a constrained external-review finding still has one honest bounded in-scope fix, attempt that alternative fix first rather than returning `out_of_scope_current_story` merely because the reviewer's preferred remedy is not allowed.
- If the selected minor finding would require changing established user-facing behavior outside approved scope and no honest in-scope fix exists for the underlying issue, do not fix it inline in this story. Do not reclassify it into current-story task-up. Write an `out_of_scope_current_story` result instead so the current behavior is preserved and the finding can be recorded as non-actionable for this story. Do not use this out-of-scope path merely because the reviewer's preferred remedy is out-of-scope when the underlying issue still has an honest in-scope repair. Do not use this out-of-scope path for bounded restoration work that puts back previously approved or preserved behavior after current-story drift.
- Reserve `blocked` for temporary operational, handoff, repository-safety, or proof-safety failures that prevent honest work in this pass. Do not use `blocked` merely because a finding would require an out-of-scope user-facing behavior change, and do not use it when the finding itself now clearly needs deeper current-story repair instead of the inline minor path.
- Before returning any non-`fixed` terminal result, restore the repository to the pre-attempt tracked state for this step so a failed inline attempt does not create overlapping local tracked edits for the next loop pass.
- Do not change public API, OpenAPI schema, persistence schema, queue contract, model shape, shared protocol, or user-visible workflow contracts in this minor path.
- Do not tighten, loosen, or reinterpret a destructive public authority boundary in this minor path.
- This step does not need to establish full end-to-end story confidence. Broader cross-repository proof and any required manual testing belong to the later final revalidation task.
- If the one-shot plan or implementation proves that the fix requires a broader design change, write a `reclassify_task_required` result with the evidence that ruled out a safe inline resolution.
- Escalate only after attempting every safe concrete action identified by the one-shot plan and confirming that the remaining change requires broader contract choice, broader lifecycle redesign, wider multi-surface coordination, or another form of planning that the coding agent cannot honestly complete on its own in this pass.
- If the implementation or proof needed for the selected finding proves to require broader proof-authoring, multi-repository change coordination, contract reinterpretation, or a larger refactor, write a `reclassify_task_required` or `blocked` result only after recording why no safe bounded next action remains.
- If targeted proof fails for an ordinary in-scope reason, diagnose and repair the selected fix while the repair remains bounded and a safe concrete next action exists.
- If the failure points to broader behavior or missing capability for only the selected finding, stop and write either a `reclassify_task_required` result or a `blocked` result with `blocker_scope: "finding_only"`.
- If the failure points to repository-wide safety trouble, broken branch scope, stale flow state, or another problem that makes further inline attempts unsafe for the remaining minor findings in this pass, stop and write a `blocked` result with `blocker_scope: "global"`.

</fix_rules>

<result_schema>

Create or update `codeInfoStatus/flow-state/minor-review-fix-result.json` with this JSON shape:

```json
{
  "schema_version": 1,
  "generated_at_utc": "<ISO-8601 UTC timestamp>",
  "story_number": "<story number>",
  "plan_path": "<canonical plan path>",
  "review_pass_id": "<review pass id or null>",
  "finding_id": "<selected finding id or null>",
  "repository": "<repository owner or null>",
  "status": "<fixed|skipped|blocked|reclassify_task_required|out_of_scope_current_story>",
  "summary": "<short selected finding summary or reason for no-op>",
  "changed_files": ["<repo-relative path>"],
  "targeted_proof": [
    {
      "command": "<command or null>",
      "result": "<passed|failed|not_run>",
      "notes": "<brief notes>"
    }
  ],
  "commit_sha": "<exact full 40-character git commit SHA or null>",
  "reclassification_reason": "<reason or null>",
  "blocker": "<blocker reason or null>",
  "blocker_scope": "<finding_only|global|null>"
}
```

</result_schema>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, write a `blocked` result with `finding_id: null` and `blocker_scope: "global"` and stop.
- If `review-disposition-state.json` is missing, unreadable, malformed, or has incompatible `schema_version`, write a `blocked` result with `finding_id: null` and `blocker_scope: "global"` and stop.
- If `unresolved_minor_batchable_findings` is empty, write a `skipped` result with `finding_id: null` and stop.
- If the target repository cannot be resolved or its branch story number does not match the plan filename, write a `blocked` result with `blocker_scope: "global"` and stop.
- If local uncommitted changes overlap the files needed for the selected minor fix, write a `blocked` result with `blocker_scope: "global"` instead of overwriting or mixing work.
- If the selected finding does not satisfy every minor-batchable rule after source inspection, still complete the internal one-shot plan and attempt any honest bounded in-scope alternative before writing a `reclassify_task_required` result.
- If the selected finding would require an out-of-scope user-facing behavior change and no honest in-scope repair exists for the underlying issue, do not write `reclassify_task_required` or `blocked`. Write an `out_of_scope_current_story` result instead.
- If targeted proof fails, follow the one-shot plan's diagnosis and retry while a safe bounded repair remains. Do not rerun an unchanged proof against an unchanged implementation or repeat an equivalent failed approach without new evidence. Prefer `reclassify_task_required` only when a materially different bounded alternative has been attempted or the resulting evidence shows that no new safe action remains and the finding clearly needs deeper current-story repair outside this path's contract. Use `blocked` only when the failure is a temporary operational or safety interruption that prevents honest work in this pass. When `blocked` is still the honest result, use `blocker_scope: "finding_only"` when the interruption is local to the selected finding and `blocker_scope: "global"` when the interruption means later inline attempts are unsafe too.
- If you wrote tracked edits during the attempt and the terminal result is not `fixed`, revert those tracked edits before writing `minor-review-fix-result.json`.
- If no tracked files changed after the attempted fix, write a `skipped` result explaining why no commit was made.
- If `status` is `fixed` and the exact `commit_sha` written to `minor-review-fix-result.json` cannot be re-verified as a commit object with git, stop and rewrite the result before finishing this step.

</failure_modes>

<output_contract>

- Fix at most one finding from the inline-fix queue.
- Write `minor-review-fix-result.json` for every terminal outcome, including skipped, blocked, or out-of-scope outcomes.
- Commit tracked changes when `status` is `fixed`.
- Report the selected finding, status, exact full 40-character commit SHA when present, and targeted proof run.

Example fixed-result commit capture flow:

```bash
git commit -m "DEV-[56] - fix review finding X" ...
full_commit_sha="$(git rev-parse HEAD)"
git cat-file -t "$full_commit_sha"
```

Then write that exact `full_commit_sha` value into `minor-review-fix-result.json`.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before `review-disposition-state.json`.
- Confirm a fresh bounded review-scope packet was loaded.
- Confirm only one finding from the inline-fix queue was selected.
- Confirm the internal one-shot resolution plan was completed before editing or reclassification.
- Confirm every safe concrete action identified by that plan was attempted before `reclassify_task_required` or `blocked` was used.
- Confirm no failed approach was repeated without new evidence, a materially different safe change, or focused proof capable of revealing new information.
- Confirm a failed first approach, initial task-required disposition, or multi-file edit was not used by itself as the reason to stop.
- Confirm no manual testing was performed.
- Confirm no broad final validation was run.
- Confirm `minor-review-fix-result.json` exists and is valid JSON.
- Confirm any non-`fixed` terminal result left no tracked edits behind from this failed or abandoned inline attempt.
- Confirm tracked changes were committed if `status` is `fixed`.
- Confirm the stored `commit_sha` is the exact full 40-character value returned by git for the fix commit when `status` is `fixed`.
- Confirm `git cat-file -t "$commit_sha"` returns `commit` when `status` is `fixed`.

</verification_loop>
