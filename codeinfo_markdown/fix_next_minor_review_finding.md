# Goal

Fix exactly one unresolved minor-batchable review finding from the current review disposition state.

This step performs the code/config/docs/test edit for one minor finding only. It does not task up findings, generate final revalidation tasks, or document the fix in the plan.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/review-disposition-state.json`.
- Use only the stored `plan_path`, `additional_repositories`, and review disposition state as the active scope.
- Re-open the exact canonical plan from disk before touching files, using explicit shell reads such as `sed`, `cat`, or `rg`.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Do not rediscover review artifacts by timestamp.
- If `needs_minor_fix_path` is not true, do not change repository files. Write a skipped result and stop.
- Select exactly one finding from `unresolved_minor_batchable_findings`, preferably the first listed item unless the state names a selected finding.
- Re-inspect the selected finding and the relevant source files before editing. If the finding is no longer clearly minor-batchable, do not fix it. Write a `reclassify_task_required` result and stop.
- Do not perform manual browser, Playwright MCP, or agent-driven validation.
- Do not run broad final validation in this step. Run only bounded local automated proof that is directly needed for the selected minor fix. This may include a small test update or one or two new focused tests in the owning repository.
- If tracked files are changed, commit them before finishing this step.
- Do not push.

</critical_rules>

<target_repository_rules>

- Resolve the selected finding's repository from its `repository` field.
- If the repository is `Current Repository`, use the current repository root.
- If the repository refers to an additional repository, resolve it from `additional_repositories` or from the `repositories` entries in `review-disposition-state.json`.
- Before touching files in the target repository, read that repository's `AGENTS.md` if it exists and follow its workflow rules.
- Verify the target repository branch story number still matches the selected plan filename story number. If it does not, write a blocked result and stop.
- Do not stash, reset, discard, or overwrite local changes. If local changes would make the minor fix unsafe to isolate, write a blocked result and stop.

</target_repository_rules>

<fix_rules>

- Keep the edit minimal and directly tied to the selected finding.
- Do not combine unrelated findings in one fix.
- A minor fix may include one or two small focused automated test updates or additions in the owning repository when that keeps the change bounded and honest.
- A minor fix may still restore an already intended same-repository contract, validation parity, or route-check ordering when that work remains bounded to one clear seam and does not broaden into a larger contract redesign.
- A bounded producer-consumer alignment fix may remain minor when it restores an already-settled returned-result contract in one same-repository service or helper seam.
- A bounded validation-order fix may remain minor when it moves malformed-input or unsupported-input validation ahead of dependency I/O to restore an already-settled request contract.
- A bounded dead-branch cleanup in a queue, lifecycle, or concurrency-sensitive helper may remain minor when source inspection confirms the branch is unreachable under the current live-state or query contract.
- For cross-surface error-classification findings, proceed in the minor path only when the classifier has already determined that the intended same-repository contract is clearly settled and the selected finding is just one bounded outlier alignment.
- Do not change public API, OpenAPI schema, persistence schema, queue contract, model shape, shared protocol, or user-visible workflow contracts in this minor path.
- Do not tighten, loosen, or reinterpret a destructive public authority boundary in this minor path.
- This step does not need to establish full end-to-end story confidence. Broader cross-repository proof and any required manual testing belong to the later final revalidation task.
- If the fix starts to require a broader design change, stop and write a `reclassify_task_required` result.
- Escalate only when the change stops being one bounded seam and starts requiring broader contract choice, broader lifecycle redesign, or wider multi-surface coordination.
- If the implementation or proof needed for the selected finding starts to require broader proof-authoring, multi-repository change coordination, contract reinterpretation, or a larger refactor, stop and write a `reclassify_task_required` or `blocked` result.
- If a targeted proof fails for an ordinary in-scope reason, inspect the failure once and repair the selected minor fix if the repair remains minor.
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
  "status": "<fixed|skipped|blocked|reclassify_task_required>",
  "summary": "<short selected finding summary or reason for no-op>",
  "changed_files": ["<repo-relative path>"],
  "targeted_proof": [
    {
      "command": "<command or null>",
      "result": "<passed|failed|not_run>",
      "notes": "<brief notes>"
    }
  ],
  "commit_sha": "<commit sha or null>",
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
- If the selected finding no longer satisfies every minor-batchable rule after source inspection, write a `reclassify_task_required` result and stop.
- If targeted proof fails and the repair is not clearly minor after one bounded inspection, write a `blocked` or `reclassify_task_required` result rather than broadening the fix. Use `blocker_scope: "finding_only"` when the failure is local to the selected finding, and `blocker_scope: "global"` when the failure means later inline attempts are unsafe too.
- If no tracked files changed after the attempted fix, write a `skipped` result explaining why no commit was made.

</failure_modes>

<output_contract>

- Fix at most one minor finding.
- Write `minor-review-fix-result.json` for every terminal outcome, including skipped or blocked outcomes.
- Commit tracked changes when `status` is `fixed`.
- Report the selected finding, status, commit SHA when present, and targeted proof run.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read before `review-disposition-state.json`.
- Confirm the exact canonical plan was re-opened from disk.
- Confirm only one minor finding was selected.
- Confirm the selected finding still satisfied the minor-batchable rules before editing.
- Confirm no manual testing was performed.
- Confirm no broad final validation was run.
- Confirm `minor-review-fix-result.json` exists and is valid JSON.
- Confirm tracked changes were committed if `status` is `fixed`.

</verification_loop>
