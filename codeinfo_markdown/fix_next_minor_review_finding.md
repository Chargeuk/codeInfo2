# Goal

Fix exactly one unresolved minor-batchable review finding from the current review disposition state.

This step performs the code/config/docs/test edit for one minor finding only. It does not task up findings, generate final revalidation tasks, or document the fix in the plan.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` after `current-plan.json`.
- Use only the stored `plan_path`, `additional_repositories`, and review disposition state as the active scope.
- Re-open the exact canonical plan from disk before touching files.
- Do not rediscover review artifacts by timestamp.
- If `needs_minor_fix_path` is not true, do not change repository files. Write a skipped result and stop.
- If `has_unresolved_task_required_findings` is true, do not fix minor findings in this step. Write a skipped result explaining that task-required findings take precedence and stop.
- Select exactly one finding from `unresolved_minor_batchable_findings`, preferably the first listed item unless the state names a selected finding.
- Re-inspect the selected finding and the relevant source files before editing. If the finding is no longer clearly minor-batchable, do not fix it. Write a `reclassify_task_required` result and stop.
- Do not perform manual browser, Playwright MCP, or agent-driven validation.
- Do not run broad final validation in this step. Run only targeted automated proof that is directly needed for the selected minor fix.
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
- Do not change public API, OpenAPI schema, persistence schema, queue contract, model shape, shared protocol, or user-visible workflow contracts in this minor path.
- If the fix starts to require a broader design change, stop and write a `reclassify_task_required` result.
- If a targeted proof fails for an ordinary in-scope reason, inspect the failure once and repair the selected minor fix if the repair remains minor.
- If the failure points to broader behavior, missing capability, flaky harness, or unrelated broken state, stop and write a blocked or reclassification result.

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
  "blocker": "<blocker reason or null>"
}
```

</result_schema>

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
