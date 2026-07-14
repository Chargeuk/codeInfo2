# Goal

Preserve the external-review-specific adjudication trail after the generic review loop has finished its task routing.

This step is bookkeeping only. It must not create tasks, fix code, or change the generic review disposition state.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact canonical plan from disk before deciding whether it needs a small note update, using explicit shell reads such as `sed`, `cat`, or `rg`.
- Derive the story number from `plan_path`, then read `codeInfoTmp/reviews/<story-number>-current-review.json` from disk, for example with `cat codeInfoTmp/reviews/<story-number>-current-review.json`.
- Use the stored review handoff plus the artifacts it references as the source of external-review context.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Do not discover review artifacts by timestamp.
- This step is external-review-only. If the current handoff does not clearly represent an external review ingestion pass, make no changes and report that this step was not applicable.
- Do not create tasks in this step.
- Do not run proof in this step.
- Do not perform manual testing in this step.
- If tracked files are changed, commit them before finishing this step.
- Do not push.

</critical_rules>

<adjudication_rules>

- Preserve the external-review adjudication trail already written into the findings artifact and optional saturation artifact, including rejected or non-adopted external comments when those sections exist.
- If the findings artifact is missing an external-review adjudication section but the handoff and artifacts make the accepted-vs-rejected outcome safely inferable, append a concise `External Review Adjudication Trail` section to the findings artifact.
- When the adjudication trail exists, preserve or repair any explicit distinction between:
  - comments rejected because the underlying issue is out-of-scope for the story;
  - comments rejected because they are invalid or unproven;
  - comments whose underlying issue was adopted as an endorsed finding but whose suggested remedy was rejected as out-of-scope for the story.
- Keep the findings artifact local-only. Do not try to force it into tracked repository history.
- If the canonical plan already contains the structured `Code Review Findings` block or a `Post-Implementation Code Review` closeout for the current `review_pass_id`, add or repair one concise sentence stating that the outcome came from ingested external review comments. Keep the plan's accepted and ignored issue summaries intact, and state that the full comment-level adjudication trail remains in the local review artifacts for this pass.
- Preserve local-fallback review-base context when it materially affects review confidence for the external pass.

</adjudication_rules>

<failure_modes>

- If `current-plan.json` is missing, unreadable, malformed, or lacks a clear `plan_path`, stop and say the current-plan handoff must be regenerated.
- If the review handoff is missing, unreadable, or does not describe an external review ingestion pass clearly enough, make no changes and report that the external adjudication step was skipped.
- If the findings artifact is missing or unreadable, make no artifact edits and report the limitation honestly.
- If tracked plan edits succeed but commit fails, stop and report the failed commit command without pretending the bookkeeping change was committed.

</failure_modes>

<output_contract>

- Preserve or repair the external-review adjudication trail in local review artifacts.
- Add at most a concise plan note when the canonical plan already contains review output for the current `review_pass_id`.
- Commit tracked plan changes only when the canonical plan itself changed.
- Report whether the adjudication trail was preserved as-is, repaired in the local artifacts, or skipped.

</output_contract>

<verification_loop>

- Confirm `current-plan.json` was read first.
- Confirm the review handoff clearly represented an external review ingestion pass before applying any external-only behavior.
- Confirm no tasks were created, reopened, or renumbered in this step.
- Confirm the external adjudication trail still records accepted vs rejected external comments when that information exists.
- Confirm any plan note added for this step stayed concise and did not try to replace the local artifact trail.
- Confirm tracked changes were committed if the plan changed.

</verification_loop>
